import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
// xlsx import eliminado: el cotizador ya no procesa Excel manualmente,
// los datos vienen del Cloudflare Worker → GitHub privado.

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 CONFIGURACIÓN DE FUENTE REMOTA (Cloudflare Worker → GitHub privado)
// ═══════════════════════════════════════════════════════════════════════════
// El cotizador NO habla directo con GitHub. Habla con un Cloudflare Worker
// que custodia el PAT server-side y reenvía las requests autenticadas.
//
// El Worker expone el endpoint:  GET <WORKER_BASE_URL>/data/<archivo>.json
// y un healthcheck:               GET <WORKER_BASE_URL>/health
//
// Cambiá WORKER_BASE_URL al subdominio que Cloudflare te asigne después
// del deploy (ej: https://cotizador-data-proxy.tu-cuenta.workers.dev),
// o a tu dominio custom si configuraste uno.
const WORKER_CONFIG = {
  baseUrl: 'https://cotizador-data-proxy.TU-CUENTA.workers.dev',
  enabled: true,                // false = modo solo-local, ignora el Worker
  cacheTTLms: 10 * 60 * 1000,   // 10 min de cache en localStorage
  fetchTimeoutMs: 10000,        // timeout por archivo (incluye latencia worker→github)
};

// Mapeo: nombre de archivo JSON en el Worker → variable local a hidratar.
// El nombre debe estar en la ALLOWED_FILES del Worker (worker.js).
const REMOTE_FILES = {
  'sueldos.json':      'SUELDOS',
  'iibb.json':         'IIBB_ALIC',
  'medicacion.json':   'XL_MEDS',
  'uniformes.json':    'XL_UNIS',
  'moviles.json':      'XL_MOVS',
  'comunicacion.json': 'XL_COMS',
  'consultorio.json':  'XL_CONS',
  'estructura.json':   'XL_ESTR',
  'logistica.json':    'XL_LOG_P',
  'trailers.json':     'XL_TRAIL',
  'defaults.json':     'DF',
  'moviles_dashboard.json':       'MOVILES_DASH',
  'trailers_dashboard.json':      'TRAILERS_DASH',
  'costos_mantenimiento.json':    'COSTOS_MANT',
  'gastos_estructura_zreal.json': 'GASTOS_ESTR_ZREAL',
  'categorias_estructura.json':   'CATEGS_ESTR',
};

const buildRemoteUrl = (filename) => {
  const base = WORKER_CONFIG.baseUrl.replace(/\/+$/,'');
  return `${base}/data/${filename}`;
};

// fmt is now defined inside the component for moneda-awareness
const uid = () => Math.random().toString(36).substr(2,9);
const Q_T = {Diario:30,Quincenal:2,Mensual:1,Semestral:1/6,Anual:1/12};
const NEGOCIOS = ['Petróleo','Minería','Operaciones dedicadas'];
const DIAGRAMAS = [
  {id:'7x7',label:'7×7 (180hs)',diasMes:15,horasDia:12,horasMes:180},
  {id:'14x14',label:'14×14 (168hs)',diasMes:15,horasDia:12,horasMes:168},
  {id:'5x2',label:'5×2 L-V (186hs)',diasMes:22,horasDia:8,horasMes:186},
  {id:'4x4',label:'4×4 (180hs)',diasMes:15,horasDia:12,horasMes:180},
  {id:'24h',label:'24h guardia',diasMes:15,horasDia:24,horasMes:360},
  {id:'manual',label:'Manual',diasMes:0,horasDia:0,horasMes:0},
];
const PROVS = ['Buenos Aires','CABA','Chubut','Córdoba','Mendoza','Neuquén','Río Negro','Santa Cruz','Santa Fe','Tierra del Fuego'];
const CONV_RD = [{v:'FATSA',l:'FATSA'},{v:'Petrolero',l:'Petrolero'},{v:'FUNCO',l:'Fuera de Convenio'}];
const CATS_CONV = {
  'FATSA':[{v:'FATSA IA',l:'IA'},{v:'FATSA IA Sur',l:'IA Sur'},{v:'FATSA IB',l:'IB'},{v:'FATSA IB Sur',l:'IB Sur'},{v:'FATSA III',l:'III'},{v:'FATSA III Sur',l:'III Sur'}],
  'Petrolero':[{v:'PP (Privado)',l:'PP Privado'},{v:'PJ (Jerarquico)',l:'PJ Jerárquico'}],
  'FUNCO':[{v:'Fuera de Convenio',l:'Fuera de Convenio'}],
};
const PUESTOS = {'FATSA IA':['Médico','Enfermero','Chofer','Chofermero'],'FATSA IA Sur':['Médico','Enfermero','Chofer','Chofermero'],'FATSA IB':['Enfermero','Chofer'],'FATSA IB Sur':['Enfermero','Chofer'],'FATSA III':['Chofer'],'FATSA III Sur':['Chofer'],'PP (Privado)':['Enfermero','Chofer'],'PJ (Jerarquico)':['Médico'],'Fuera de Convenio':['Médico','Enfermero','Chofer','Chofermero'],'Monotributo':['Médico','Enfermero','Chofer','Chofermero']};
const T_HE = [{v:'HE50',l:'HE 50%',f:1.5},{v:'HE100',l:'HE 100%',f:2.0},{v:'HEFer',l:'Feriado',f:2.5}];
const VI_DEF = [{tipo:'Desayuno',precio:8000,incluir:true},{tipo:'Almuerzo',precio:15000,incluir:true},{tipo:'Merienda',precio:6000,incluir:false},{tipo:'Cena',precio:15000,incluir:true}];
let SUELDOS = {"Neuquen":{"FATSA":{"FATSA IA":{"chofermero":{b:1831894,c:2589778}},"FATSA IA Sur":{"chofermero":{b:2369462,c:3354712}},"FATSA IB":{"enfermero":{b:1483833,c:2085091}},"FATSA IB Sur":{"enfermero":{b:1876983,c:2658618}},"FATSA III":{"chofer":{b:1327541,c:1876467}},"FATSA III Sur":{"chofer":{b:1725803,c:2439407}}},"Petrolero":{"PP (Privado)":{"enfermero":{b:5032987,c:5427371},"chofer":{b:4919078,c:5304943}},"PJ (Jerarquico)":{"medico":{b:12200507,c:16402974}}},"FUNCO":{"Fuera de Convenio":{"enfermero":{b:1100000,c:1430000},"medico":{b:1650000,c:2145000},"chofer":{b:920000,c:1196000},"chofermero":{b:1000000,c:1300000}}},"Monotributista":{"Monotributo":{"enfermero":{b:820000,c:902000},"medico":{b:1200000,c:1320000},"chofer":{b:720000,c:792000},"chofermero":{b:780000,c:858000}}}}};
const ANIO_ACTUAL = new Date().getFullYear();

// 2️⃣ MASTERS DE MEDICACIÓN por negocio
const MED_MASTERS = {
  'Petróleo':[
    {id:'pet_uti',nombre:'UTI Petrolero',items:['Adrenalina 1mg','Atropina 1mg','Amiodarona 150mg','Diclofenac 75mg','Sol.Fisio.500ml','Collar Cervical','Férula SAM','Cefalexina 500mg']},
    {id:'pet_bas',nombre:'Básico Petrolero',items:['Diclofenac 75mg','Sol.Fisio.500ml','Collar Cervical','Cefalexina 500mg']},
  ],
  'Minería':[
    {id:'min_uti',nombre:'UTI Minería',items:['Adrenalina 1mg','Atropina 1mg','Amiodarona 150mg','Diclofenac 75mg','Sol.Fisio.500ml','Férula SAM','Cefalexina 500mg']},
    {id:'min_bas',nombre:'Básico Minería',items:['Diclofenac 75mg','Sol.Fisio.500ml','Cefalexina 500mg']},
  ],
  'Operaciones dedicadas':[
    {id:'op_uti',nombre:'UTI Op.Dedicadas',items:['Adrenalina 1mg','Atropina 1mg','Diclofenac 75mg','Sol.Fisio.500ml','Collar Cervical','Férula SAM']},
    {id:'op_bas',nombre:'Básico Op.Dedicadas',items:['Diclofenac 75mg','Sol.Fisio.500ml']},
  ],
};

// 3️⃣ CAPACITACIONES por puesto y negocio
const CAPS_POR_PUESTO = {
  'Médico':['PHTLS','ACLS','BLS'],
  'Enfermero':['PHTLS','ACLS','BLS'],
  'Chofer':['BLS','Manejo Defensivo'],
  'Chofermero':['BLS','Manejo Defensivo','PHTLS'],
};
const CAPS_POR_NEGOCIO = {
  'Petróleo':['H2S','Seguridad Petrolera'],
  'Minería':['Trabajo en Altura','Seguridad Minera'],
  'Operaciones dedicadas':['Primeros Auxilios Avanzado'],
};

let DF = {
  viandas:{Desayuno:8000,Almuerzo:15000,Merienda:8000,Cena:15000},
  movDisp:[],
  trDisp:[],
  trAlq:[{mod:'Trailer Sanitario Alq.',tipo:'Sanitario',cm:380000},{mod:'Trailer Habit. Alq.',tipo:'Habitacional',cm:420000}],
  trCompra:[{mod:'Trailer Sanitario Nuevo',tipo:'Sanitario',px:18000000,vu:15,res:3000000},{mod:'Trailer Habit. Nuevo',tipo:'Habitacional',px:22000000,vu:15,res:4000000}],
  ambCompra:[{mod:'Renault Master',px:25000000,vu:10,res:5000000},{mod:'Fiat Ducato',px:23000000,vu:10,res:4500000},{mod:'Mercedes Sprinter',px:35000000,vu:12,res:7000000}],
  ambAlq:[{mod:'Renault Master',cm:450000},{mod:'Fiat Ducato',cm:420000}],
  equip:[{i:'Desfibrilador',cu:3500000,qt:'Anual'},{i:'Monitor SV',cu:2200000,qt:'Anual'},{i:'Camilla',cu:850000,qt:'Anual'},{i:'Equipo O2',cu:450000,qt:'Anual'}],
  otros:[{c:'Comunicaciones',cm:45000},{c:'Insumos Médicos',cm:120000},{c:'Descartables',cm:85000},{c:'Medicamentos',cm:150000}],
  estr:[{c:'Administración',cm:350000},{c:'Coordinación Op.',cm:280000},{c:'Sistemas',cm:120000},{c:'Legales',cm:180000}],
  seg:[{t:'RC General',p:250000},{t:'RC Profesional',p:180000},{t:'ART',p:120000},{t:'Vida Oblig.',p:35000}],
  items:[{i:'EPP',cu:45000,qt:'Semestral'},{i:'Uniformes',cu:65000,qt:'Semestral'},{i:'Examen Ingreso',cu:35000,qt:'Anual'},{i:'Traslado Personal',cu:28000,qt:'Mensual'}],
  caps:[{n:'PHTLS',ct:180000,f:'Anual',dest:10},{n:'ACLS',ct:220000,f:'Anual',dest:8},{n:'BLS',ct:95000,f:'Anual',dest:15},{n:'Manejo Defensivo',ct:65000,f:'Anual',dest:12},{n:'H2S',ct:45000,f:'Anual',dest:20},{n:'Seguridad Petrolera',ct:55000,f:'Anual',dest:20},{n:'Trabajo en Altura',ct:75000,f:'Anual',dest:15},{n:'Seguridad Minera',ct:60000,f:'Anual',dest:15},{n:'Primeros Auxilios Avanzado',ct:85000,f:'Anual',dest:12}],
  medDB:[{id:'m1',nombre:'Adrenalina 1mg',cat:'Emergencia',unidad:'Ampolla',pu:2500},{id:'m2',nombre:'Atropina 1mg',cat:'Emergencia',unidad:'Ampolla',pu:1800},{id:'m3',nombre:'Amiodarona 150mg',cat:'Cardiología',unidad:'Ampolla',pu:4200},{id:'m4',nombre:'Diclofenac 75mg',cat:'Analgésicos',unidad:'Ampolla',pu:950},{id:'m5',nombre:'Sol.Fisio.500ml',cat:'General',unidad:'Frasco',pu:3500},{id:'m6',nombre:'Collar Cervical',cat:'Traumatología',unidad:'Unidad',pu:8500},{id:'m7',nombre:'Férula SAM',cat:'Traumatología',unidad:'Unidad',pu:12000},{id:'m8',nombre:'Cefalexina 500mg',cat:'Antibióticos',unidad:'Comp.',pu:350}],
  logistica:[{c:'Chofer logístico',cm:850000},{c:'Vehículo logístico',cm:250000},{c:'Combustible',cm:120000,esCombustible:true}],
  CE:35,
};

const getSueldo = (prov,conv,cat,puesto,ov) => {
  const k=puesto.toLowerCase();const pn=prov==='Neuquén'?'Neuquen':prov;
  if(ov?.[`${conv}|${cat}|${k}`])return ov[`${conv}|${cat}|${k}`];
  const e=SUELDOS[pn]?.[conv]?.[cat]?.[k];if(e)return e;
  if(conv==='Monotributista'){const m=SUELDOS[pn]?.Monotributista?.Monotributo?.[k];if(m)return m;}
  return{b:0,c:0};
};
const sB=(bg)=>({padding:'8px 16px',background:bg,color:'white',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:13});
const sI={width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,marginTop:4};
const sIs={width:'100%',padding:'6px 10px',border:'1px solid #d1d5db',borderRadius:6,fontSize:13,marginTop:2};
const sL={display:'flex',flexDirection:'column',fontSize:13,fontWeight:600,color:'#374151'};
const sLs={display:'flex',flexDirection:'column',fontSize:12,fontWeight:600,color:'#4b5563'};
const sT={width:'100%',borderCollapse:'collapse',fontSize:13};
const sTh={padding:'10px 12px',textAlign:'left',fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'0.05em'};
const sTd={padding:'10px 12px'};
const sWC=(bg,brd)=>({display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:24,borderRadius:12,border:`2px dashed ${brd}`,background:bg,cursor:'pointer'});
const sCard={background:'white',border:'1px solid #e2e8f0',borderRadius:12,padding:16,marginBottom:12};


// ═══ EXCEL DATA (auto-generated) ═══
let XL_MEDS = [];
let XL_UNIS = [{"n": "PETROLEO", "e": 1, "i": "CALZADO SEGURIDAD", "u": 48000.0, "ta": 48000.0, "tm": 4000.0}, {"n": "PETROLEO", "e": 2, "i": "CHAQUETA", "u": 41000.0, "ta": 82000.0, "tm": 6833.33}, {"n": "PETROLEO", "e": 1, "i": "CHOMBA NEGRA (Vista)", "u": 10086.14, "ta": 10086.14, "tm": 840.51}, {"n": "PETROLEO", "e": 1, "i": "BUZO", "u": 27982.0, "ta": 27982.0, "tm": 2331.83}, {"n": "PETROLEO", "e": 1, "i": "CASCO", "u": 11685.96, "ta": 11685.96, "tm": 973.83}, {"n": "PETROLEO", "e": 1, "i": "PROT. AUDITIVO", "u": 33969.09, "ta": 33969.09, "tm": 2830.76}, {"n": "PETROLEO", "e": 2, "i": "PANTALON CARGO", "u": 50254.24, "ta": 100508.48, "tm": 8375.71}, {"n": "PETROLEO", "e": 1, "i": "CAMPERA", "u": 74000.0, "ta": 74000.0, "tm": 6166.67}, {"n": "PETROLEO", "e": 1, "i": "PRIMERA PIEL", "u": 11083.0, "ta": 11083.0, "tm": 923.58}, {"n": "PETROLEO", "e": 1, "i": "MAMELUCO (Vista)", "u": 118400.0, "ta": 118400.0, "tm": 9866.67}, {"n": "PETROLEO 2", "e": 2, "i": "CALZADO SEGURIDAD", "u": 48000.0, "ta": 96000.0, "tm": 8000.0}, {"n": "PETROLEO 2", "e": 1, "i": "CHAQUETA", "u": 20500.0, "ta": 20500.0, "tm": 1708.33}, {"n": "PETROLEO 2", "e": 2, "i": "CHOMBA NEGRA (Vista)", "u": 10086.14, "ta": 20172.28, "tm": 1681.02}, {"n": "PETROLEO 2", "e": 1, "i": "BUZO", "u": 0, "ta": 0.0, "tm": 0.0}, {"n": "PETROLEO 2", "e": 1, "i": "PANTALON CARGO", "u": 0, "ta": 0.0, "tm": 0.0}, {"n": "PETROLEO 2", "e": 1, "i": "CAMPERA", "u": 0, "ta": 0.0, "tm": 0.0}, {"n": "PETROLEO 2", "e": 1, "i": "PRIMERA PIEL", "u": 0, "ta": 0.0, "tm": 0.0}, {"n": "PETROLEO 2", "e": 2, "i": "MAMELUCO (Vista)", "u": 118400.0, "ta": 236800.0, "tm": 19733.33}, {"n": "MINERIA", "e": 2, "i": "CHOMBA", "u": 12717.33, "ta": 25434.66, "tm": 2119.55}, {"n": "MINERIA", "e": 2, "i": "PANTALON", "u": 39404.98, "ta": 78809.96, "tm": 6567.5}, {"n": "MINERIA", "e": 1, "i": "PRIMERA PIEL", "u": 11083.8, "ta": 11083.8, "tm": 923.65}, {"n": "MINERIA", "e": 2, "i": "CAMPERA POLAR", "u": 36309.0, "ta": 72618.0, "tm": 6051.5}, {"n": "MINERIA", "e": 1, "i": "CHALECO TERMICO", "u": 23569.0, "ta": 23569.0, "tm": 1964.08}, {"n": "MINERIA", "e": 1, "i": "CAMPERA", "u": 109948.85, "ta": 109948.85, "tm": 9162.4}, {"n": "MINERIA", "e": 1, "i": "PANTALON", "u": 79881.76, "ta": 79881.76, "tm": 6656.81}, {"n": "MINERIA", "e": 2, "i": "MEDIAS TERMICAS", "u": 12254.4, "ta": 24508.8, "tm": 2042.4}, {"n": "MINERIA", "e": 1, "i": "PASAMONTAÑA", "u": 6370.0, "ta": 6370.0, "tm": 530.83}, {"n": "MINERIA", "e": 1, "i": "GUANTES", "u": 8000.0, "ta": 8000.0, "tm": 666.67}, {"n": "MINERIA", "e": 1, "i": "ANTEOJOS OSCUROS", "u": 19547.55, "ta": 19547.55, "tm": 1628.96}, {"n": "MINERIA", "e": 1, "i": "ANTEOJOS CLAROS", "u": 19547.55, "ta": 19547.55, "tm": 1628.96}, {"n": "MINERIA", "e": 1, "i": "CARCAZA CASCO", "u": 11685.96, "ta": 11685.96, "tm": 973.83}, {"n": "MINERIA", "e": 1, "i": "PROTECTOR AUDITIVO", "u": 33968.88, "ta": 33968.88, "tm": 2830.74}, {"n": "MINERIA", "e": 1, "i": "BOTIN", "u": 101500.0, "ta": 101500.0, "tm": 8458.33}, {"n": "MINERIA", "e": 1, "i": "BOTA DE NIEVE", "u": 154245.6, "ta": 154245.6, "tm": 12853.8}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "CALZADO SEGURIDAD", "u": 48000.0, "ta": 48000.0, "tm": 4000.0}, {"n": "OPERACIONES DEDICADAS", "e": 2, "i": "CHAQUETA", "u": 41000.0, "ta": 82000.0, "tm": 6833.33}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "BUZO", "u": 27982.0, "ta": 27982.0, "tm": 2331.83}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "CASCO", "u": 11685.96, "ta": 11685.96, "tm": 973.83}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "PROT. AUDITIVO", "u": 33969.09, "ta": 33969.09, "tm": 2830.76}, {"n": "OPERACIONES DEDICADAS", "e": 2, "i": "PANTALON CARGO", "u": 50254.24, "ta": 100508.48, "tm": 8375.71}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "CAMPERA", "u": 74000.0, "ta": 74000.0, "tm": 6166.67}, {"n": "OPERACIONES DEDICADAS", "e": 1, "i": "PRIMERA PIEL", "u": 11083.0, "ta": 11083.0, "tm": 923.58}];
let XL_MOVS = [];
let XL_COMS = [{"i": "Antena Starlink Mini", "q": 1, "v": 238140.0, "a": 36, "m": 6615.0}, {"i": "Abono Starlink", "q": 1, "v": 87500.0, "a": 1, "m": 87500.0}, {"i": "Computadora", "q": 1, "v": 2200000.0, "a": 36, "m": 61111.11}, {"i": "TV", "q": 1, "v": 720000.0, "a": 60, "m": 12000.0}, {"i": "Impresora Laser color /escaner", "q": 1, "v": 750000.0, "a": 60, "m": 12500.0}, {"i": "Handy", "q": 1, "v": 0, "a": 1, "m": 0}, {"i": "Radio Base", "q": 1, "v": 0, "a": 1, "m": 0}];
let XL_CONS = [{"n": "MINERIA", "t": "CONSULTORIO", "i": "DEA", "q": 1, "cu": 1595000.0, "ct": 1595000.0, "qm": 60, "am": 26583.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Monitor Multiparamétrico Portatil", "q": 1, "cu": 1226500.0, "ct": 1226500.0, "qm": 60, "am": 20441.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Bombas de infusión", "q": 1, "cu": 968000.0, "ct": 968000.0, "qm": 60, "am": 16133.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Respirador Portatil", "q": 1, "cu": 14000000.0, "ct": 14000000.0, "qm": 60, "am": 233333.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Calibración: Desfibrilador", "q": 3, "cu": 573300.0, "ct": 1719900.0, "qm": 36, "am": 47775.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Calibración: Electrocardiógrafo", "q": 3, "cu": 292200.0, "ct": 876600.0, "qm": 36, "am": 24350.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Calibración: Monitor", "q": 3, "cu": 386500.0, "ct": 1159500.0, "qm": 36, "am": 32208.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "SEGURO: Desfibrilador", "q": 3, "cu": 1950.0, "ct": 5850.0, "qm": 1, "am": 5850.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "SEGURO: Electrocardiógrafo", "q": 3, "cu": 1200.0, "ct": 3600.0, "qm": 1, "am": 3600.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "SEGURO : Monitor", "q": 3, "cu": 675.0, "ct": 2025.0, "qm": 1, "am": 2025.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Tensiómetro", "q": 1, "cu": 53949.0, "ct": 53949.0, "qm": 60, "am": 899.15}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Estetoscopio Littman", "q": 1, "cu": 297500.0, "ct": 297500.0, "qm": 60, "am": 4958.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Compresor para nebulizar, con aspirador", "q": 1, "cu": 150000.0, "ct": 150000.0, "qm": 60, "am": 2500.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Recipiente para residuos patológicos y descartador de corto punzantes de acero", "q": 1, "cu": 200000.0, "ct": 200000.0, "qm": 60, "am": 3333.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Estufa para esterilizar", "q": 1, "cu": 200000.0, "ct": 200000.0, "qm": 60, "am": 3333.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Caja de curaciones: pinzas de disección con o sin dientes, tijera de curaciones, pinzas de Kocher", "q": 1, "cu": 365000.0, "ct": 365000.0, "qm": 24, "am": 15208.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Caja de sutura completa", "q": 1, "cu": 554800.0, "ct": 554800.0, "qm": 24, "am": 23116.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Termómetro laser", "q": 1, "cu": 50000.0, "ct": 50000.0, "qm": 60, "am": 833.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Termómetro clínico", "q": 1, "cu": 10000.0, "ct": 10000.0, "qm": 60, "am": 166.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Bolso Trauma", "q": 1, "cu": 1387000.0, "ct": 1387000.0, "qm": 12, "am": 115583.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Bolso vías aéreas", "q": 1, "cu": 219000.0, "ct": 219000.0, "qm": 12, "am": 18250.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Aspirador mecanico", "q": 1, "cu": 250330.58, "ct": 250330.58, "qm": 60, "am": 4172.18}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Férulas de inmovilización: Superior e inferior", "q": 1, "cu": 100000.0, "ct": 100000.0, "qm": 60, "am": 1666.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Cuello inmovilizador", "q": 1, "cu": 50000.0, "ct": 50000.0, "qm": 60, "am": 833.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Chaleco de Kendricks", "q": 1, "cu": 150000.0, "ct": 150000.0, "qm": 60, "am": 2500.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Oxímetro", "q": 1, "cu": 50000.0, "ct": 50000.0, "qm": 60, "am": 833.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Cama", "q": 1, "cu": 1000000.0, "ct": 1000000.0, "qm": 60, "am": 16666.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Impresora Laser color /escaner", "q": 1, "cu": 750000.0, "ct": 750000.0, "qm": 60, "am": 12500.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Antena para internet", "q": 1, "cu": 550000.0, "ct": 550000.0, "qm": 60, "am": 9166.67}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Computadora", "q": 1, "cu": 2200000.0, "ct": 2200000.0, "qm": 36, "am": 61111.11}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "TV recepción", "q": 1, "cu": 720000.0, "ct": 720000.0, "qm": 60, "am": 12000.0}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Pie de suero", "q": 1, "cu": 170000.0, "ct": 170000.0, "qm": 60, "am": 2833.33}, {"n": "MINERIA", "t": "CONSULTORIO", "i": "Muletas", "q": 1, "cu": 95000.0, "ct": 95000.0, "qm": 60, "am": 1583.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Desfibrilador y cardio desfibrilador fijo con función marcapaso y DEA.", "q": 1, "cu": 6300000.0, "ct": 6300000.0, "qm": 60, "am": 105000.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Electrocardiógrafo diagnóstico.", "q": 1, "cu": 971043.61, "ct": 971043.61, "qm": 60, "am": 16184.06}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Monitor multiparamétrico.", "q": 1, "cu": 1397825.0, "ct": 1397825.0, "qm": 60, "am": 23297.08}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Calibración: Desfibrilador", "q": 3, "cu": 573300.0, "ct": 1719900.0, "qm": 36, "am": 47775.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Calibración: Electrocardiógrafo", "q": 3, "cu": 292200.0, "ct": 876600.0, "qm": 36, "am": 24350.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Calibración: Monitor", "q": 3, "cu": 386500.0, "ct": 1159500.0, "qm": 36, "am": 32208.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "SEGURO: Desfibrilador", "q": 3, "cu": 1950.0, "ct": 5850.0, "qm": 1, "am": 5850.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "SEGURO: Electrocardiógrafo", "q": 3, "cu": 1200.0, "ct": 3600.0, "qm": 1, "am": 3600.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "SEGURO : Monitor", "q": 3, "cu": 675.0, "ct": 2025.0, "qm": 1, "am": 2025.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Oxímetro de pulso", "q": 1, "cu": 20299.0, "ct": 20299.0, "qm": 36, "am": 563.86}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Resucitador portatil autoinflable con reservorio", "q": 1, "cu": 35000.0, "ct": 35000.0, "qm": 36, "am": 972.22}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Aspirador portátil manual V-VAC.", "q": 1, "cu": 55000.0, "ct": 55000.0, "qm": 36, "am": 1527.78}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Laringoscopio con set de intubación", "q": 1, "cu": 124000.0, "ct": 124000.0, "qm": 36, "am": 3444.44}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Torniquetes homologados (CAT o SOF-T).", "q": 1, "cu": 48990.0, "ct": 48990.0, "qm": 36, "am": 1360.83}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Tensiómetro.", "q": 1, "cu": 20700.0, "ct": 20700.0, "qm": 36, "am": 575.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Estetoscopio.", "q": 1, "cu": 19400.0, "ct": 19400.0, "qm": 36, "am": 538.89}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Glucómetro.", "q": 1, "cu": 45445.0, "ct": 45445.0, "qm": 36, "am": 1262.36}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Otoscopio", "q": 1, "cu": 94500.0, "ct": 94500.0, "qm": 36, "am": 2625.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Termómetro", "q": 1, "cu": 3900.0, "ct": 3900.0, "qm": 36, "am": 108.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Tubo de oxígeno de 2 m³", "q": 1, "cu": 300000.0, "ct": 300000.0, "qm": 36, "am": 8333.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Recarga tubos de oxígeno", "q": 2, "cu": 40000.0, "ct": 80000.0, "qm": 24, "am": 3333.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Camillas con barandas desplazables y cubre camillas descartables.", "q": 1, "cu": 789509.0, "ct": 789509.0, "qm": 36, "am": 21930.81}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Frazadas", "q": 2, "cu": 31264.0, "ct": 62528.0, "qm": 36, "am": 1736.89}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Manta polar", "q": 2, "cu": 28240.0, "ct": 56480.0, "qm": 36, "am": 1568.89}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Tablas rígidas", "q": 1, "cu": 174900.0, "ct": 174900.0, "qm": 36, "am": 4858.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Collares cervicales (juego completo).", "q": 2, "cu": 53190.0, "ct": 106380.0, "qm": 36, "am": 2955.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Férulas rígidas para los cuatro miembros", "q": 1, "cu": 76666.0, "ct": 76666.0, "qm": 36, "am": 2129.61}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Inmovilizador latero cervical.", "q": 1, "cu": 78390.0, "ct": 78390.0, "qm": 36, "am": 2177.5}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Tijera de trauma", "q": 1, "cu": 8900.0, "ct": 8900.0, "qm": 36, "am": 247.22}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Linterna", "q": 1, "cu": 10000.0, "ct": 10000.0, "qm": 36, "am": 277.78}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Pinza Magill.", "q": 1, "cu": 53501.0, "ct": 53501.0, "qm": 36, "am": 1486.14}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Bolso de transporte para elementos de primeros auxilios", "q": 1, "cu": 300000.0, "ct": 300000.0, "qm": 36, "am": 8333.33}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Lazo de látex", "q": 2, "cu": 3000.0, "ct": 6000.0, "qm": 36, "am": 166.67}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Mango de bisturí N° 3", "q": 1, "cu": 2339.0, "ct": 2339.0, "qm": 36, "am": 64.97}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Mango de bisturí N° 4", "q": 1, "cu": 2339.0, "ct": 2339.0, "qm": 36, "am": 64.97}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Conservadora de frio/calor portátil grande", "q": 1, "cu": 90000.0, "ct": 90000.0, "qm": 36, "am": 2500.0}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Carro de Paro", "q": 1, "cu": 1558000.0, "ct": 1558000.0, "qm": 36, "am": 43277.78}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Soporte para suero, cuatro soportes", "q": 2, "cu": 76325.83, "ct": 152651.66, "qm": 36, "am": 4240.32}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Una escalerilla para camillas", "q": 1, "cu": 59500.0, "ct": 59500.0, "qm": 36, "am": 1652.78}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Cesto de residuos comunes grande con tapa", "q": 1, "cu": 28300.0, "ct": 28300.0, "qm": 36, "am": 786.11}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Cesto de residuos patogénicos grandes con tapa", "q": 1, "cu": 28300.0, "ct": 28300.0, "qm": 36, "am": 786.11}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Cesto de residuos patogénicos grandes, para exterior con tapa, cadena y candado", "q": 1, "cu": 182644.0, "ct": 182644.0, "qm": 36, "am": 5073.44}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Silla de ruedas plegable", "q": 1, "cu": 850000.0, "ct": 850000.0, "qm": 36, "am": 23611.11}, {"n": "PETROLEO", "t": "CONSULTORIO", "i": "Balanza de pie, con tallímetro", "q": 1, "cu": 1590000.0, "ct": 1590000.0, "qm": 36, "am": 44166.67}, {"n": "PETROLEO", "t": "Adicionales", "i": "Alquiler tubo ultraliviano", "q": 0, "cu": 0, "ct": 0, "qm": 1, "am": 70000.0}, {"n": "PETROLEO", "t": "Adicionales", "i": "Alquiler tubo 10mts3", "q": 0, "cu": 0, "ct": 0, "qm": 1, "am": 135000.0}, {"n": "PETROLEO", "t": "Adicionales", "i": "Reposición m3 - Tubo 0,5 mts3 a 5mts3", "q": 0, "cu": 0, "ct": 0, "qm": 1, "am": 37672.23}, {"n": "PETROLEO", "t": "Adicionales", "i": "Reposición m3 - Tubo 6 mts3 a 10mts3", "q": 0, "cu": 0, "ct": 0, "qm": 1, "am": 8162.52}];
let XL_ESTR = [{"pr": "Neuquén", "co": "ALQUILERES", "tp": "GT- ALQ EDIFICIOS", "at": "BASES NQN 2025", "v": 118045281.53}, {"pr": "San Juan", "co": "ALQUILERES", "tp": "GT- ALQ EDIFICIOS", "at": "BASE SAN JUAN 2025", "v": 35456880.0}, {"pr": "Salta", "co": "ALQUILERES", "tp": "GT- ALQ EDIFICIOS", "at": "BASE SALTA 2025", "v": 21121287.0}, {"pr": "Neuquén", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- CAFETERIA", "at": "BASES NQN 2025", "v": 6227800.0}, {"pr": "San Juan", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- CAFETERIA", "at": "BASE SAN JUAN 2025", "v": 0.0}, {"pr": "Salta", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- CAFETERIA", "at": "BASE SALTA 2025", "v": 0.0}, {"pr": "Neuquén", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- COMEDOR/REFRI", "at": "BASES NQN 2025", "v": 53150666.2}, {"pr": "San Juan", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- COMEDOR/REFRI", "at": "BASE SAN JUAN 2025", "v": 28093090.26}, {"pr": "Salta", "co": "BENEFICIOS AL PERSONAL", "tp": "GT- COMEDOR/REFRI", "at": "BASE SALTA 2025", "v": 2410395.0}, {"pr": "Neuquén", "co": "INSUMOS DE OFICINA", "tp": "GT- IMPRENTA COMERC", "at": "BASES NQN 2025", "v": 3563197.59}, {"pr": "San Juan", "co": "INSUMOS DE OFICINA", "tp": "GT- IMPRENTA COMERC", "at": "BASE SAN JUAN 2025", "v": 3931846.18}, {"pr": "Salta", "co": "INSUMOS DE OFICINA", "tp": "GT- IMPRENTA COMERC", "at": "BASE SALTA 2025", "v": 1228297.37}, {"pr": "Neuquén", "co": "INSUMOS DE OFICINA", "tp": "GT- INSUMOS COMPU", "at": "BASES NQN 2025", "v": 6965405.69}, {"pr": "San Juan", "co": "INSUMOS DE OFICINA", "tp": "GT- INSUMOS COMPU", "at": "BASE SAN JUAN 2025", "v": 1279583.14}, {"pr": "Salta", "co": "INSUMOS DE OFICINA", "tp": "GT- INSUMOS COMPU", "at": "BASE SALTA 2025", "v": 17500.0}, {"pr": "Neuquén", "co": "INSUMOS DE OFICINA", "tp": "GT- UTILES LIBRERÍA", "at": "BASES NQN 2025", "v": 4573098.24}, {"pr": "San Juan", "co": "INSUMOS DE OFICINA", "tp": "GT- UTILES LIBRERÍA", "at": "BASE SAN JUAN 2025", "v": 5884768.82}, {"pr": "Salta", "co": "INSUMOS DE OFICINA", "tp": "GT- UTILES LIBRERÍA", "at": "BASE SALTA 2025", "v": 1237949.08}, {"pr": "Neuquén", "co": "LIMPIEZA Y VIGILANCIA", "tp": "GT- LIMPIEZA", "at": "BASES NQN 2025", "v": 102967242.52}, {"pr": "San Juan", "co": "LIMPIEZA Y VIGILANCIA", "tp": "GT- LIMPIEZA", "at": "BASE SAN JUAN 2025", "v": 22467367.37}, {"pr": "Salta", "co": "LIMPIEZA Y VIGILANCIA", "tp": "GT- LIMPIEZA", "at": "BASE SALTA 2025", "v": 16129162.74}, {"pr": "Neuquén", "co": "MANTENIMIENTO", "tp": "GT- MANT EDIFICIOS", "at": "BASES NQN 2025", "v": 84634459.68}, {"pr": "San Juan", "co": "MANTENIMIENTO", "tp": "GT- MANT EDIFICIOS", "at": "BASE SAN JUAN 2025", "v": 21264179.16}, {"pr": "Salta", "co": "MANTENIMIENTO", "tp": "GT- MANT EDIFICIOS", "at": "BASE SALTA 2025", "v": 17135620.32}, {"pr": "Neuquén", "co": "MANTENIMIENTO", "tp": "GT- MANT SOFTWARE", "at": "BASES NQN 2025", "v": 15687118.11}, {"pr": "San Juan", "co": "MANTENIMIENTO", "tp": "GT- MANT SOFTWARE", "at": "BASE SAN JUAN 2025", "v": 43747143.0}, {"pr": "Salta", "co": "MANTENIMIENTO", "tp": "GT- MANT SOFTWARE", "at": "BASE SALTA 2025", "v": 2532100.0}, {"pr": "Neuquén", "co": "SEGUROS", "tp": "GT- OTROS SEGUROS", "at": "BASES NQN 2025", "v": 14136373.19}, {"pr": "San Juan", "co": "SEGUROS", "tp": "GT- OTROS SEGUROS", "at": "BASE SAN JUAN 2025", "v": 2338508.06}, {"pr": "Salta", "co": "SEGUROS", "tp": "GT- OTROS SEGUROS", "at": "BASE SALTA 2025", "v": 1152697.24}, {"pr": "Neuquén", "co": "SEGUROS", "tp": "GT- SEG RESP CIVIL", "at": "BASES NQN 2025", "v": 47307.55}, {"pr": "San Juan", "co": "SEGUROS", "tp": "GT- SEG RESP CIVIL", "at": "BASE SAN JUAN 2025", "v": 0.0}, {"pr": "Salta", "co": "SEGUROS", "tp": "GT- SEG RESP CIVIL", "at": "BASE SALTA 2025", "v": 0.0}, {"pr": "Neuquén", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENERGIA ELEC", "at": "BASES NQN 2025", "v": 2327455.63}, {"pr": "San Juan", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENERGIA ELEC", "at": "BASE SAN JUAN 2025", "v": 2796680.4}, {"pr": "Salta", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENERGIA ELEC", "at": "BASE SALTA 2025", "v": 2657973.26}, {"pr": "Neuquén", "co": "SERVICIOS PUBLICOS", "tp": "GT- GAS Y AGUA", "at": "BASES NQN 2025", "v": 1279148.98}, {"pr": "San Juan", "co": "SERVICIOS PUBLICOS", "tp": "GT- GAS Y AGUA", "at": "BASE SAN JUAN 2025", "v": 1350195.25}, {"pr": "Salta", "co": "SERVICIOS PUBLICOS", "tp": "GT- GAS Y AGUA", "at": "BASE SALTA 2025", "v": 0.0}, {"pr": "Neuquén", "co": "SERVICIOS PUBLICOS", "tp": "GT- TELEFONIA MOVIL", "at": "BASES NQN 2025", "v": 0.0}, {"pr": "San Juan", "co": "SERVICIOS PUBLICOS", "tp": "GT- TELEFONIA MOVIL", "at": "BASE SAN JUAN 2025", "v": 4885.11}, {"pr": "Salta", "co": "SERVICIOS PUBLICOS", "tp": "GT- TELEFONIA MOVIL", "at": "BASE SALTA 2025", "v": 0.0}, {"pr": "Neuquén", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENLACES", "at": "BASES NQN 2025", "v": 0.0}, {"pr": "San Juan", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENLACES", "at": "BASE SAN JUAN 2025", "v": 562400.0}, {"pr": "Salta", "co": "SERVICIOS PUBLICOS", "tp": "GT- ENLACES", "at": "BASE SALTA 2025", "v": 1488137.0}];
let XL_LOG_P = [{"p": "Qty Personas", "v": 3}, {"p": "Qty Kms", "v": 140}, {"p": "Qty Rotación", "v": 2}, {"p": "Qty Viajes", "v": 2}, {"p": "Qty Semanas", "v": 4}, {"p": "$ LITRO", "v": 1572}, {"p": "QTY LITROS X TANQUE", "v": 75}, {"p": "KM x TANQUE", "v": 500}, {"p": "Chofer", "v": 2110301.12}, {"p": "Vehiculo de Logistica", "v": 2372887.28}, {"p": "incidencia", "v": 0.25}];
let XL_TRAIL = [];
let IIBB_ALIC = {'Neuquén':3.6,'Mendoza':4,'San Juan':3.5,'Salta':3.6,'Chubut':3,'Santa Cruz':3.5,'Río Negro':3.5,'Tierra del Fuego':3,'Buenos Aires':4.5,'CABA':3,'Córdoba':4.75,'Entre Ríos':4,'La Pampa':3.5,'Tucumán':3.5,'Misiones':4,'Corrientes':4,'Catamarca':3,'La Rioja':3,'Santiago del Estero':3.5,'San Luis':3,'Jujuy':3.5,'Formosa':4,'Chaco':4.5};
// ─── Datos remotos NUEVOS (Dashboard + Mantenimiento + ZREAL) ───
let MOVILES_DASH = [];   // moviles_dashboard.json (109 móviles reales con estado)
let TRAILERS_DASH = [];  // trailers_dashboard.json (10 trailers reales)
let COSTOS_MANT = [];    // costos_mantenimiento.json (121 costos EECC)
let GASTOS_ESTR_ZREAL = { ultimo_mes:'', verticales:{} };  // gastos_estructura_zreal.json
let CATEGS_ESTR = { categorias_estructura:[] };            // categorias_estructura.json

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 LOADER REMOTO — hidrata las variables de arriba desde el Worker
// ═══════════════════════════════════════════════════════════════════════════
// Estrategia: lee cada JSON desde el Cloudflare Worker, lo VALIDA contra un
// schema mínimo, y solo si pasa lo asigna a la variable correspondiente.
// Si la validación falla, queda el dato local (fallback automático).
//
// Cache: localStorage con TTL (WORKER_CONFIG.cacheTTLms).

const CACHE_KEY = 'cotizador_remote_cache_v2';

// ─── CACHE LOCAL ─────────────────────────────────────────────────────────
const readCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > WORKER_CONFIG.cacheTTLms) return null;
    return parsed.data;
  } catch { return null; }
};

const writeCache = (data) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); }
  catch { /* quota exceeded, ignorar */ }
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDADORES POR VARIABLE
// ═══════════════════════════════════════════════════════════════════════════
// Cada validador retorna { ok: boolean, error?: string }.
// Reglas:
//   - Tienen que ser RÁPIDOS (no recorrer todas las filas si no es necesario).
//   - Validan estructura MÍNIMA, no exhaustiva. Mejor pasar un dato parcialmente
//     correcto que hacer fallback a un local desactualizado.
//   - Si fallan, el log a consola tiene que ser CLARO para debug.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && !isNaN(v);
const isStr = (v) => typeof v === 'string';
const isArr = (v) => Array.isArray(v);

// Verifica que todas las filas de un array tengan las keys requeridas.
// Hace muestreo: chequea las primeras 3 + 1 random + última. Suficiente
// para detectar archivos con formato incorrecto sin recorrer todo.
const sampleArrayHasKeys = (arr, requiredKeys) => {
  if (arr.length === 0) return { ok: true };
  const indices = new Set([0, 1, 2, arr.length - 1, Math.floor(Math.random() * arr.length)]);
  for (const i of indices) {
    if (i < 0 || i >= arr.length) continue;
    const row = arr[i];
    if (!isObj(row)) {
      return { ok: false, error: `fila ${i} no es objeto` };
    }
    for (const k of requiredKeys) {
      if (!(k in row)) {
        return { ok: false, error: `fila ${i} falta key '${k}' (encontradas: ${Object.keys(row).join(',')})` };
      }
    }
  }
  return { ok: true };
};

const VALIDATORS = {
  SUELDOS: (data) => {
    if (!isObj(data)) return { ok: false, error: 'no es objeto' };
    const provincias = Object.keys(data);
    if (provincias.length === 0) return { ok: false, error: 'sin provincias' };
    // Drill-down en una provincia: prov → conv → cat → puesto → {b,c}
    const sampleProv = provincias[0];
    const convenios = Object.keys(data[sampleProv] || {});
    if (convenios.length === 0) return { ok: false, error: `provincia '${sampleProv}' sin convenios` };
    const sampleConv = convenios[0];
    const categorias = Object.keys(data[sampleProv][sampleConv] || {});
    if (categorias.length === 0) return { ok: false, error: `${sampleProv}/${sampleConv} sin categorías` };
    const sampleCat = categorias[0];
    const puestos = Object.keys(data[sampleProv][sampleConv][sampleCat] || {});
    if (puestos.length === 0) return { ok: false, error: `${sampleProv}/${sampleConv}/${sampleCat} sin puestos` };
    const samplePuesto = data[sampleProv][sampleConv][sampleCat][puestos[0]];
    if (!isObj(samplePuesto) || !isNum(samplePuesto.b) || !isNum(samplePuesto.c)) {
      return { ok: false, error: `puesto sin {b,c} numéricos: ${JSON.stringify(samplePuesto)}` };
    }
    return { ok: true };
  },

  IIBB_ALIC: (data) => {
    if (!isObj(data)) return { ok: false, error: 'no es objeto' };
    const keys = Object.keys(data);
    if (keys.length === 0) return { ok: false, error: 'sin provincias' };
    for (const k of keys.slice(0, 5)) {
      if (!isNum(data[k])) return { ok: false, error: `${k}: alicuota no numérica (${data[k]})` };
    }
    return { ok: true };
  },

  XL_MOVS: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['ec', 'tp', 'cl', 'de', 'in', 'vu', 'qt', 'vm']);
  },

  XL_TRAIL: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['cat', 'i', 'neg', 'vc', 'm', 'vm']);
  },

  XL_UNIS: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['n', 'e', 'i', 'u', 'ta', 'tm']);
  },

  XL_COMS: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['i', 'q', 'v', 'a', 'm']);
  },

  XL_CONS: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['n', 't', 'i', 'q', 'cu', 'ct', 'qm', 'am']);
  },

  XL_ESTR: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    return sampleArrayHasKeys(data, ['pr', 'co', 'tp', 'at', 'v']);
  },

  XL_LOG_P: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    const result = sampleArrayHasKeys(data, ['p', 'v']);
    if (!result.ok) return result;
    // Verificar que existan los parámetros críticos que el cotizador busca por nombre
    const required = ['Chofer', 'Vehiculo de Logistica', 'incidencia'];
    const found = new Set(data.map((r) => r.p));
    const missing = required.filter((p) => !found.has(p));
    if (missing.length > 0) {
      return { ok: false, error: `parámetros críticos faltantes: ${missing.join(', ')}` };
    }
    return { ok: true };
  },

  XL_MEDS: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    if (data.length === 0) return { ok: true }; // medicación puede estar vacía
    return sampleArrayHasKeys(data, ['id', 'n', 'cl', 'nombre', 'cat', 'unidad', 'pu']);
  },

  DF: (data) => {
    if (!isObj(data)) return { ok: false, error: 'no es objeto' };
    // DF se mergea con el local, así que aceptamos cualquier subset.
    // Solo validamos que las claves conocidas (si están presentes) tengan el tipo correcto.
    if ('CE' in data && !isNum(data.CE)) return { ok: false, error: 'CE no numérico' };
    if ('caps' in data && !isArr(data.caps)) return { ok: false, error: 'caps no es array' };
    if ('trAlq' in data && !isArr(data.trAlq)) return { ok: false, error: 'trAlq no es array' };
    if ('trCompra' in data && !isArr(data.trCompra)) return { ok: false, error: 'trCompra no es array' };
    return { ok: true };
  },
  MOVILES_DASH: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    if (data.length === 0) return { ok: true };
    return sampleArrayHasKeys(data, ['tipo', 'estado', 'disp', 'modelo']);
  },
  TRAILERS_DASH: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    if (data.length === 0) return { ok: true };
    return sampleArrayHasKeys(data, ['tipo', 'modelo', 'cm', 'disp']);
  },
  COSTOS_MANT: (data) => {
    if (!isArr(data)) return { ok: false, error: 'no es array' };
    if (data.length === 0) return { ok: true };
    return sampleArrayHasKeys(data, ['origen', 'cat', 'subcat', 'item', 'vm']);
  },
  GASTOS_ESTR_ZREAL: (data) => {
    if (!isObj(data)) return { ok: false, error: 'no es objeto' };
    if (!isObj(data.verticales)) return { ok: false, error: 'sin verticales' };
    const vs = Object.keys(data.verticales);
    if (vs.length === 0) return { ok: false, error: 'verticales vacío' };
    const sample = data.verticales[vs[0]];
    if (!isNum(sample.total_mes) || !isNum(sample.total_estructura_mes)) {
      return { ok: false, error: 'vertical sin total_mes/total_estructura_mes' };
    }
    return { ok: true };
  },
  CATEGS_ESTR: (data) => {
    if (!isObj(data)) return { ok: false, error: 'no es objeto' };
    if (!isArr(data.categorias_estructura)) return { ok: false, error: 'sin categorias_estructura' };
    return { ok: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HIDRATACIÓN
// ═══════════════════════════════════════════════════════════════════════════
// Reasigna la variable correspondiente. Solo se llama después de validar.
const hydrateVariable = (varName, newValue) => {
  switch (varName) {
    case 'SUELDOS':   SUELDOS = newValue; break;
    case 'IIBB_ALIC': IIBB_ALIC = newValue; break;
    case 'DF':        DF = { ...DF, ...newValue }; break;
    case 'XL_MEDS':   XL_MEDS = newValue; break;
    case 'XL_UNIS':   XL_UNIS = newValue; break;
    case 'XL_MOVS':   XL_MOVS = newValue; break;
    case 'XL_COMS':   XL_COMS = newValue; break;
    case 'XL_CONS':   XL_CONS = newValue; break;
    case 'XL_ESTR':   XL_ESTR = newValue; break;
    case 'XL_LOG_P':  XL_LOG_P = newValue; break;
    case 'XL_TRAIL':  XL_TRAIL = newValue; break;
    case 'MOVILES_DASH':      MOVILES_DASH = newValue; break;
    case 'TRAILERS_DASH':     TRAILERS_DASH = newValue; break;
    case 'COSTOS_MANT':       COSTOS_MANT = newValue; break;
    case 'GASTOS_ESTR_ZREAL': GASTOS_ESTR_ZREAL = newValue; break;
    case 'CATEGS_ESTR':       CATEGS_ESTR = newValue; break;
    default: console.warn('[cotizador] hydrateVariable: variable desconocida', varName);
  }
};

// Wrapper que valida + hidrata. Devuelve { ok, error? }.
const validateAndHydrate = (varName, newValue) => {
  const validator = VALIDATORS[varName];
  if (!validator) {
    console.warn(`[cotizador] sin validador para ${varName}, hidratando sin chequear`);
    hydrateVariable(varName, newValue);
    return { ok: true };
  }
  const result = validator(newValue);
  if (!result.ok) {
    console.error(
      `[cotizador] ❌ validación de ${varName} falló: ${result.error}\n` +
      `             → usando datos locales como fallback`
    );
    return { ok: false, error: result.error };
  }
  hydrateVariable(varName, newValue);
  return { ok: true };
};

// ═══════════════════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════════════════
const fetchWithTimeout = async (url, ms) => {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) {
      // Intentar leer el body de error para diagnóstico
      let errorDetail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) errorDetail += `: ${body.error}${body.message ? ' - ' + body.message : ''}`;
      } catch { /* body no es JSON */ }
      throw new Error(errorDetail);
    }
    return await res.json();
  } finally { clearTimeout(tid); }
};

// Carga todos los archivos remotos en paralelo. Cada archivo es independiente:
// uno que falle (red, validación, etc.) no aborta el resto.
//
// GARANTÍAS DE ROBUSTEZ:
//   1. Esta función SIEMPRE resuelve. Nunca rechaza, nunca cuelga.
//   2. Tiene un timeout global hard-stop además del timeout por request,
//      por si el AbortController falla (DNS lento, TLS handshake colgado).
//   3. Cualquier excepción interna se captura y se reporta como fallback.
const loadRemoteData = async () => {
  // Wrapper con hard-stop: si todo el proceso tarda más de 2x el timeout
  // por archivo, abortamos y devolvemos lo que haya. Garantiza que la app
  // siempre renderice aunque la red esté en un estado patológico.
  const HARD_STOP_MS = WORKER_CONFIG.fetchTimeoutMs * 2 + 2000;

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardStopTimer);
      resolve(result);
    };

    const hardStopTimer = setTimeout(() => {
      console.error(`[cotizador] ⏱ hard-stop timeout (${HARD_STOP_MS}ms) — usando datos locales`);
      safeResolve({ ok: [], fail: [{ varName: 'all', error: 'hard-stop timeout' }], invalid: [], source: 'timeout' });
    }, HARD_STOP_MS);

    (async () => {
      try {
        if (!WORKER_CONFIG.enabled) {
          return safeResolve({ ok: [], fail: [], invalid: [], source: 'local-disabled' });
        }

        // 1) Intentar cache primero. Los datos en cache YA pasaron validación
        // cuando se guardaron, así que no re-validamos.
        const cached = readCache();
        if (cached) {
          Object.entries(cached).forEach(([varName, value]) => hydrateVariable(varName, value));
          return safeResolve({ ok: Object.keys(cached), fail: [], invalid: [], source: 'cache' });
        }

        // 2) Fetch en paralelo desde el Worker
        const entries = Object.entries(REMOTE_FILES);
        const results = await Promise.allSettled(
          entries.map(([filename]) => fetchWithTimeout(buildRemoteUrl(filename), WORKER_CONFIG.fetchTimeoutMs))
        );

        const ok = [], fail = [], invalid = [], snapshot = {};
        results.forEach((r, i) => {
          const [filename, varName] = entries[i];
          if (r.status === 'fulfilled') {
            try {
              const validation = validateAndHydrate(varName, r.value);
              if (validation.ok) {
                snapshot[varName] = r.value;
                ok.push(varName);
              } else {
                invalid.push({ varName, filename, error: validation.error });
              }
            } catch (e) {
              // Defensa extra: si el validador o hydrate tiran, no rompemos el loader
              invalid.push({ varName, filename, error: 'validator threw: ' + e.message });
            }
          } else {
            const errMsg = r.reason?.message || 'fetch failed';
            console.error(`[cotizador] ❌ fetch ${filename} falló: ${errMsg} → usando datos locales`);
            fail.push({ varName, filename, error: errMsg });
          }
        });

        // 3) Guardar en cache solo lo que pasó validación
        if (ok.length > 0) writeCache(snapshot);

        safeResolve({ ok, fail, invalid, source: 'remote' });
      } catch (e) {
        // Cualquier error inesperado en el flujo: caer a fallback local
        console.error(`[cotizador] ❌ error inesperado en loadRemoteData: ${e.message} → usando datos locales`);
        safeResolve({ ok: [], fail: [{ varName: 'all', error: e.message }], invalid: [], source: 'error' });
      }
    })();
  });
};

const SistemaCotizadorOpComplejas = () => {
  const [prov,setProv]=useState('Neuquén');const [plazo,setPlazo]=useState(12);const [dolar,setDolar]=useState(1250);
  const [nomCot,setNomCot]=useState('');const [cliente,setCliente]=useState('');const [negocio,setNegocio]=useState('Petróleo');
  const [mesCot,setMesCot]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;});
  const [sec,setSec]=useState('config');const [sueldoOv,setSueldoOv]=useState({});const [monedaVis,setMonedaVis]=useState('ARS');
  const fmtARS=(n)=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:0}).format(n||0);
  const fmt=(n)=>{if(monedaVis==='USD'&&dolar>0){const v=(n||0)/dolar;return 'U$S '+new Intl.NumberFormat('es-AR',{minimumFractionDigits:0,maximumFractionDigits:0}).format(v);}return fmtARS(n);};
  const [precioNafta,setPrecioNafta]=useState(1150);const [precioGasoil,setPrecioGasoil]=useState(1050);
  const [pctConcSalRem,setPctConcSalRem]=useState(35);
  const [lineas,setLineas]=useState([{id:uid(),nombre:'AMBULANCIA UTI',um:'MES',mu:15},{id:uid(),nombre:'AMBULANCIA TRASLADO',um:'MES',mu:15}]);
  const [personal,setPersonal]=useState([]);const [ambulancias,setAmbulancias]=useState([]);
  const [ambWiz,setAmbWiz]=useState({step:1,orig:'',tadq:'',tamb:'UTI'});const [ambIG,setAmbIG]=useState('');
  const [trailers,setTrailers]=useState([]);const [trWiz,setTrWiz]=useState({step:1,orig:'',tadq:'',tipo:''});const [trIG,setTrIG]=useState('');
  const [hospedaje,setHospedaje]=useState([]);
  const [uniforme,setUniforme]=useState([]);
  const [movilesXL,setMovilesXL]=useState([]);const [movEecc,setMovEecc]=useState('');
  const [equipamiento,setEquipamiento]=useState([]);
  const [otrosCostos,setOtrosCostos]=useState([]);const [estructura,setEstructura]=useState([]);
  
  const [capacitaciones,setCapacitaciones]=useState([]);
  const [medicamentos,setMedicamentos]=useState([]);const [medMaster,setMedMaster]=useState('');
  const [logistica,setLogistica]=useState([]);const [logParams,setLogParams]=useState(()=>XL_LOG_P.map(p=>({...p})));
  const [logImpG,setLogImpG]=useState([]);const [medImpG,setMedImpG]=useState([]);const [otrosImpG,setOtrosImpG]=useState([]);const [equipImpG,setEquipImpG]=useState([]);const [estrImpG,setEstrImpG]=useState([]);
  const [personalBk,setPersonalBk]=useState([]);
  const [bkRedist,setBkRedist]=useState({on:false,lids:[]});const [comunicacion,setComunicacion]=useState([]);const [logMovXL,setLogMovXL]=useState([]);const [logMovEc,setLogMovEc]=useState('');
  const [resVista,setResVista]=useState('mes');
  const [impOn,setImpOn]=useState(false);
  const [iibbAlic,setIibbAlic]=useState(IIBB_ALIC[prov]||3.5);
  const [selloAlic,setSelloAlic]=useState(1);
  const [otroImp,setOtroImp]=useState({nombre:'',alic:0,fijo:0});
  const [logMode,setLogMode]=useState('traslado');
  const [soporteAmb,setSoporteAmb]=useState(null);const [soporteTrail,setSoporteTrail]=useState(null);

  // Hidratación de "disponibles" desde los datos REALES del Dashboard.
  // Móviles: MOVILES_DASH filtrado por disp===1 (Estado 'Back Up').
  // Trailers: TRAILERS_DASH filtrado por disp===1 (Disponible 'Si').
  useEffect(() => {
    if (Array.isArray(MOVILES_DASH) && MOVILES_DASH.length > 0) {
      const ambs = MOVILES_DASH
        .filter(m => m.disp === 1)
        .map((m) => ({
          'ID': m.id, 'Interno': m.interno, 'Dominio': m.dom,
          'Tipo': m.tipo, 'Modelo': m.modelo, 'Año': m.anio,
          'Estado': m.estado, 'Vertical': m.vert, 'Disponibilidad': 'DISPONIBLE',
        }));
      setSoporteAmb(ambs);
    }
    if (Array.isArray(TRAILERS_DASH) && TRAILERS_DASH.length > 0) {
      const trs = TRAILERS_DASH
        .filter(t => t.disp === 1)
        .map((t) => ({
          'Dominio': t.id, 'Tipo': t.tipo, 'Modelo': t.modelo,
          'Antigüedad': t.antig, 'CostoMensual': t.cm, 'Disponibilidad': 'DISPONIBLE',
        }));
      setSoporteTrail(trs);
    }
  }, []);

  // ─── Helpers de COSTOS ASOCIADOS (EECC) desde Mantenimiento ───
  // Devuelve los costos (tipo_registro=COSTO) de un origen/subcategoría.
  // origen: 'Ambulancias' | 'Trailers' | 'Logistica'
  const getCostosEECC = useCallback((origen, subcatFilter) => {
    if (!Array.isArray(COSTOS_MANT)) return [];
    return COSTOS_MANT
      .filter(c => c.origen === origen && (!subcatFilter || c.subcat === subcatFilter))
      .map(c => ({
        id: uid(), item: c.item, subcat: c.subcat,
        qty: c.qty || 1, precioUnit: c.vm || 0,   // P y qty editables
        origen: c.origen,
      }));
  }, []);
  const [logAuto,setLogAuto]=useState({tipo:'horas',horas:0,tarifa:0,plus:0});
  const [logButaca,setLogButaca]=useState({tipo:'',tarifa:0});
  const [exp,setExp]=useState({});const [redistModal,setRedistModal]=useState(null);const [redistSel,setRedistSel]=useState([]);
  const [filtroMed,setFiltroMed]=useState({cat:'Todos',unidad:'Todos',q:''});
  const [resExp,setResExp]=useState({});
  const d=DF;const CE=d.CE;const tExp=(id)=>setExp(p=>({...p,[id]:!p[id]}));

  const cMens=(m,qt)=>m*(Q_T[qt]||1);const cMon=(m,mon)=>mon==='USD'?m*dolar:m;
  const cItem=(it)=>cMon(cMens((it.qty||1)*(it.precioUnit||0),it.qTemp||'Mensual'),it.moneda||'ARS');
  const distL=(ct,imps)=>{if(!imps?.length)return{};const r={};imps.forEach(i=>{r[i.lid]=(r[i.lid]||0)+ct*(i.pct/100);});return r;};
  const totImp=(imps)=>(imps||[]).reduce((s,i)=>s+(i.pct||0),0);
  const cMed=(m)=>(m.qty||0)*(m.pu||0)*(Q_T[m.qTemp||'Mensual']||1);
  const antAnios=(anio)=>anio?ANIO_ACTUAL-anio:0;

  // Logística fórmulas del Excel
  const getLP=(name)=>{const p=logParams.find(x=>x.p===name);return p?p.v:0;};
  const logCalc=useMemo(()=>{
    const chofer=getLP('Chofer');const vehiculo=getLP('Vehiculo de Logistica');const inc=getLP('incidencia');
    const pers=getLP('Qty Personas');const sem=getLP('Qty Semanas');const kms=getLP('Qty Kms');
    const rot=getLP('Qty Rotación');const viajes=getLP('Qty Viajes');const litro=getLP('$ LITRO');
    const litrosTanque=getLP('QTY LITROS X TANQUE');const kmTanque=getLP('KM x TANQUE');
    const cChofer=pers>0&&sem>0?(chofer*inc)/sem/pers:0;
    const cVehiculo=pers>0&&sem>0?(vehiculo*inc)/sem/pers:0;
    const cComb=pers>0&&kmTanque>0?((kms*(rot+viajes))/kmTanque)*(litrosTanque*litro)/pers:0;
    return[{cl:'Chofer',v:cChofer},{cl:'Vehículo Logística',v:cVehiculo},{cl:'Combustible Logística',v:cComb}];
  },[logParams]);

  const calcP=useCallback((p)=>{
    if(p.tipo==='MT'){const s=getSueldo(prov,'Monotributista','Monotributo',p.puesto,sueldoOv);
      let ccs=0;(p.conceptos||[]).forEach(cs=>{const b=(cs.qty||0)*(cs.pu||0);ccs+=cs.rem?b*(1+pctConcSalRem/100):b;});
      return{b:s.b,c:s.c*(p.qty||1)+ccs,ccs};}
    const s=getSueldo(prov,p.convenio,p.categoria,p.puesto,sueldoOv);let base=s.c||(s.b*1.35);
    if(p.convenio==='FATSA'&&s.b>0){let ex=0;if(p.ad?.pres)ex+=s.b*0.0833;if(p.ad?.enf&&p.puesto==='Enfermero')ex+=s.b*0.15;if(p.ad?.noc&&p.pctN>0)ex+=s.b*0.20*(Math.min(p.pctN,100)/100);if(p.ad?.ant&&p.anios>0)ex+=s.b*0.01*Math.min(p.anios,30);base+=ex;}
    let vi=0;if(p.convenio==='Petrolero'&&p.viandas){const dg=DIAGRAMAS.find(x=>x.id===p.diagrama);(p.viandas||[]).filter(v=>v.incluir).forEach(v=>{vi+=(v.precio||0)*(dg?.diasMes||15);});}
    let costoHE=0;const vh=(s.b||0)/Math.max((DIAGRAMAS.find(x=>x.id===p.diagrama)?.horasMes||180),1);
    (p.horasExtra||[]).forEach(he=>{const t=T_HE.find(t=>t.v===he.tipo);costoHE+=(he.qty||0)*vh*(t?.f||1.5);});
    let ccs=0;(p.conceptos||[]).forEach(cs=>{const b=(cs.qty||0)*(cs.pu||0);ccs+=cs.rem?b*(1+pctConcSalRem/100):b;});
    return{b:s.b,c:(base+vi+costoHE)*(p.qty||1)+ccs,vi,he:costoHE,ccs};
  },[prov,sueldoOv,pctConcSalRem]);

  const validarP=(p)=>{const e=[];if((p.qty||0)<1)e.push('Qty>0');if(!p.diagrama)e.push('Diagrama');if(p.tipo==='RD'&&!p.convenio)e.push('Convenio');if(p.tipo==='RD'&&!p.categoria)e.push('Cat.');if(!p.puesto)e.push('Puesto');if(p.ad?.noc&&(p.pctN||0)>100)e.push('Noct≤100');if(p.ad?.ant&&(p.anios||0)>30)e.push('Ant≤30');const ti=totImp(p.impactos);if(p.impactos?.length>0&&Math.abs(ti-100)>0.1)e.push('Imp≠100');return e;};

  // Costo total mensual de una ambulancia: amortización/alquiler + combustible + EECC.
  const cAmb=useCallback((a)=>{
    const comb=a.origen==='adq'?((a.kms||0)/Math.max(a.rendKmL||3,0.1))*(a.precioComb||0):0;
    const eecc=a.origen==='adq'&&a.eecc?a.eecc.reduce((s,e)=>s+(e.qty||1)*(e.precioUnit||0),0):0;
    return (a.cm||0)+comb+eecc;
  },[]);
  // Costo total mensual de un trailer: alquiler/amortización + combustible + EECC.
  const cTr=useCallback((t)=>{
    const comb=t.origen==='adq'?((t.kms||0)/Math.max(t.rendKmL||3,0.1))*(t.precioComb||0):0;
    const eecc=t.origen==='adq'&&t.eecc?t.eecc.reduce((s,e)=>s+(e.qty||1)*(e.precioUnit||0),0):0;
    return (t.cm||0)+comb+eecc;
  },[]);

  const logExtraCost=useMemo(()=>{if(logMode==='autorrelevo')return logAuto.tipo==='horas'?logAuto.horas*logAuto.tarifa:logAuto.plus;if(logMode==='butaca')return logButaca.tarifa;return 0;},[logMode,logAuto,logButaca]);
  const catCosts=useMemo(()=>{
    const cc=[
      {id:'personal',l:'Personal',t:personal.reduce((s,p)=>s+calcP(p).c,0)},
      {id:'ambulancias',l:'Ambulancias',t:ambulancias.reduce((s,a)=>s+cAmb(a),0)},
      {id:'trailers',l:'Trailers',t:trailers.reduce((s,t)=>s+cTr(t),0)},
      {id:'equipamiento',l:'Equip. Consultorio',t:equipamiento.reduce((s,e)=>s+cItem(e),0)},
      {id:'otrosCostos',l:'Otros',t:otrosCostos.reduce((s,o)=>s+cItem(o),0)},
      {id:'estructura',l:'Gastos de Estructura',t:estructura.reduce((s,e)=>s+cItem(e),0)},
      {id:'logistica',l:'Logística',t:logCalc.reduce((s,l)=>s+l.v,0)+logistica.reduce((s,l)=>s+cItem(l),0)+logMovXL.reduce((s,m)=>s+(m.vm||0),0)+logExtraCost},
      {id:'medicamentos',l:'Medicación',t:medicamentos.reduce((s,m)=>s+cMed(m),0)},
      {id:'uniforme',l:'Uniforme',t:uniforme.reduce((s,u)=>s+(u.tm||0),0)},
      {id:'eeccmov',l:'EECC Móviles',t:movilesXL.reduce((s,m)=>s+(m.vm||0),0)},
      {id:'comunicacion',l:'Comunicación',t:comunicacion.reduce((s,it)=>s+cItem(it),0)},
    ];
    return cc.filter(c=>c.t>0);
  },[personal,ambulancias,trailers,equipamiento,otrosCostos,estructura,logistica,logCalc,logMovXL,medicamentos,uniforme,movilesXL,comunicacion,calcP,cAmb,cTr]);

  const bkTotalCost=useMemo(()=>personalBk.reduce((s,p)=>s+calcP(p).c,0),[personalBk,calcP]);

  // ═══ GASTOS DE ESTRUCTURA — prorrateo proporcional sobre ZREAL ═══
  // Fórmula confirmada por el usuario:
  //   % = costos_totales_cotizacion(sin estructura) / gastos_totales_vertical_mes (ZREAL)
  //   gasto_imputado = % × gastos_estructura_vertical_mes (ZREAL)
  // La vertical se deriva del 'negocio' de Config (Petróleo→PETROLEO, etc.).

  // Costo total mensual de la cotización EXCLUYENDO estructura (numerador).
  const costoTotalSinEstructura = useMemo(() => {
    return catCosts.filter(c => c.id !== 'estructura').reduce((s,c)=>s+c.t, 0);
  }, [catCosts]);

  // Mapea el negocio de Config a la VERTICAL del ZREAL.
  const verticalZreal = useMemo(() => {
    const n = (negocio||'').toLowerCase();
    if (n.includes('petr')) return 'PETROLEO';
    if (n.includes('min'))  return 'MINERIA';
    return 'OTRAS OPERACIONES DEDICADAS';
  }, [negocio]);

  // Cálculo del gasto de estructura imputado (memoizado).
  const estructuraProrrateo = useMemo(() => {
    const z = GASTOS_ESTR_ZREAL?.verticales?.[verticalZreal];
    if (!z || !(z.total_mes > 0)) {
      return { ok:false, motivo:'Sin datos ZREAL para '+verticalZreal,
               vertical:verticalZreal, numerador:costoTotalSinEstructura,
               denominador:0, pct:0, gastoEstrVertical:0, imputadoMensual:0 };
    }
    const pct = costoTotalSinEstructura / z.total_mes;
    const imputadoMensual = pct * z.total_estructura_mes;
    return {
      ok:true, vertical:verticalZreal,
      numerador:costoTotalSinEstructura,
      denominador:z.total_mes,
      gastoEstrVertical:z.total_estructura_mes,
      pct, imputadoMensual,
      ultimoMes:GASTOS_ESTR_ZREAL.ultimo_mes,
    };
  }, [verticalZreal, costoTotalSinEstructura]);

  const totales=useMemo(()=>{
    const pL={};lineas.forEach(l=>{pL[l.id]={c:0,n:l.nombre,mu:l.mu};});
    const add=(cost,imps,defLine)=>{if(imps?.length>0){const dd=distL(cost,imps);Object.entries(dd).forEach(([lid,v])=>{if(pL[lid])pL[lid].c+=v;});}else if(defLine&&pL[defLine])pL[defLine].c+=cost;else if(lineas[0]&&pL[lineas[0].id])pL[lineas[0].id].c+=cost;};
    personal.forEach(p=>add(calcP(p).c,p.impactos));
    ambulancias.forEach(a=>add(cAmb(a),null,a.impL||ambIG));
    trailers.forEach(t=>add(cTr(t),null,t.impL||trIG));
    [hospedaje].forEach(arr=>arr.forEach(it=>add(cItem(it),it.impactos)));
    equipamiento.forEach(it=>{const c=cItem(it);if(equipImpG.length>0)add(c,equipImpG);else add(c,it.impactos);});
    estructura.forEach(it=>{const c=cItem(it);if(estrImpG.length>0)add(c,estrImpG);else add(c,it.impactos);});
    capacitaciones.forEach(cap=>{if(cap.activa!==false)add((cap.costoTotal||0)*(Q_T[cap.freq]||1),cap.impactos);});
    medicamentos.forEach(med=>{const c=cMed(med);if(medImpG.length>0)add(c,medImpG);else add(c,med.impactos);});
    const logTotal=logCalc.reduce((s,l)=>s+l.v,0)+logMovXL.reduce((s,m)=>s+(m.vm||0),0)+logExtraCost;if(logTotal>0)add(logTotal,logImpG.length>0?logImpG:null);
    logistica.forEach(lg=>add(cItem(lg),lg.impactos));
    uniforme.forEach(u=>add(u.tm||0,u.impactos));
    movilesXL.forEach(m=>add(m.vm||0,m.impactos));
    otrosCostos.forEach(it=>{const c=cItem(it);if(otrosImpG.length>0)add(c,otrosImpG);else add(c,it.impactos);});
    if(bkTotalCost>0&&bkRedist.on&&bkRedist.lids.length>0){const selV=bkRedist.lids.reduce((s,lid)=>{const c=pL[lid]?.c||0;return s+c*(1+(pL[lid]?.mu||15)/100);},0);bkRedist.lids.forEach(lid=>{if(pL[lid]&&selV>0){const v=(pL[lid].c*(1+(pL[lid].mu||15)/100))/selV;pL[lid].c+=bkTotalCost*v;}});}
    comunicacion.forEach(it=>add(cItem(it),it.impactos));
    let tM=0,tV=0;Object.values(pL).forEach(l=>{tM+=l.c;tV+=l.c*(1+l.mu/100);});
    return{pL,tM,tV,tC:tV*plazo};
  },[personal,ambulancias,trailers,equipamiento,otrosCostos,estructura,capacitaciones,hospedaje,medicamentos,logistica,logCalc,logMovXL,logExtraCost,logImpG,medImpG,otrosImpG,equipImpG,estrImpG,uniforme,movilesXL,comunicacion,personalBk,bkRedist,bkTotalCost,lineas,ambIG,trIG,plazo,dolar,calcP]);

  const SubBar=({items,calc,color,label})=>{const t=items.reduce((s,it)=>s+calc(it),0);if(!items.length)return null;return(<div style={{padding:12,background:color+'08',borderRadius:10,border:`1px solid ${color}30`,marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><span style={{fontSize:12,fontWeight:700,color}}>{label}</span><span style={{fontSize:11,color:'#6b7280',marginLeft:8}}>{items.length} ítem(s)</span></div><span style={{fontSize:16,fontWeight:800,color}}>{fmt(t)}/mes</span></div>);};
  const ImpEd=({imps=[],onChange})=>{const tot=totImp(imps);return(<div style={{background:'#f8f7ff',border:'1px solid #e0dff5',borderRadius:8,padding:10,marginTop:8}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><span style={{fontSize:12,fontWeight:700,color:'#5b21b6'}}>⟡ Impactos:</span><button onClick={()=>onChange([...imps,{lid:lineas[0]?.id||'',pct:0}])} style={{fontSize:11,color:'#7c3aed',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>+ Línea</button></div>{imps.map((imp,i)=>(<div key={i} style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}><select value={imp.lid} onChange={e=>{const n=[...imps];n[i].lid=e.target.value;onChange(n);}} style={{flex:1,padding:'3px 6px',borderRadius:5,border:'1px solid #d1d5db',fontSize:12}}>{lineas.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</select><input type="number" value={imp.pct} onChange={e=>{const n=[...imps];n[i].pct=Number(e.target.value);onChange(n);}} style={{width:50,padding:'3px 6px',borderRadius:5,border:'1px solid #d1d5db',fontSize:12,textAlign:'right'}}/><span style={{fontSize:12}}>%</span><button onClick={()=>onChange(imps.filter((_,j)=>j!==i))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:14}}>✕</button></div>))}<div style={{fontSize:11,marginTop:3,color:Math.abs(tot-100)<0.1?'#059669':'#dc2626',fontWeight:700}}>Total: {tot}% {Math.abs(tot-100)<0.1?'✓':'⚠'}</div></div>);};
  const ImpG=({imps,setImps,total,color,label})=>{const tot=totImp(imps);const auto=()=>{const tV=lineas.reduce((s,l)=>{const c=totales.pL[l.id]?.c||0;return s+c*(1+l.mu/100);},0);setImps(lineas.map(l=>{const v=(totales.pL[l.id]?.c||0)*(1+l.mu/100);return{lid:l.id,pct:tV>0?Math.round(v/tV*100):0};}));};return(<div style={{padding:10,background:color+'08',borderRadius:10,border:`1px solid ${color}30`,marginTop:10}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><span style={{fontSize:12,fontWeight:700,color}}>⟡ {label} — {fmt(total)}/m</span><div style={{display:'flex',gap:4}}><button onClick={auto} style={{fontSize:10,color,background:'white',border:`1px solid ${color}50`,borderRadius:4,padding:'1px 6px',cursor:'pointer'}}>🤖 Auto</button><button onClick={()=>setImps([...imps,{lid:lineas[0]?.id||'',pct:0}])} style={{fontSize:10,color,background:'none',border:'none',cursor:'pointer',fontWeight:700}}>+ Línea</button></div></div>{imps.map((imp,i)=>(<div key={i} style={{display:'flex',gap:4,alignItems:'center',marginBottom:2}}><select value={imp.lid} onChange={e=>{const n=[...imps];n[i].lid=e.target.value;setImps(n);}} style={{flex:1,padding:'2px 4px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11}}>{lineas.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</select><input type="number" value={imp.pct} onChange={e=>{const n=[...imps];n[i].pct=Number(e.target.value);setImps(n);}} style={{width:45,padding:'2px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11,textAlign:'right'}}/><span style={{fontSize:10}}>%</span><button onClick={()=>setImps(imps.filter((_,j)=>j!==i))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:12}}>✕</button></div>))}<div style={{fontSize:10,marginTop:2,color:Math.abs(tot-100)<0.1?'#059669':'#dc2626',fontWeight:700}}>Total: {tot}% {Math.abs(tot-100)<0.1?'✓':'⚠ Debe ser 100%'}</div></div>);};
  const redistItems=useMemo(()=>{const all=[];personal.forEach(p=>all.push({id:p.id,label:'👥 '+(p.puesto||'?'),venta:calcP(p).c*1.15}));ambulancias.forEach(a=>all.push({id:a.id,label:'🚑 '+a.mod,venta:(a.cm||0)*1.15}));return all;},[personal,ambulancias,calcP]);
  const RedistModal=()=>{if(!redistModal)return null;const sel=redistItems.filter(x=>redistSel.includes(x.id));const tot=sel.reduce((s,x)=>s+x.venta,0);return(<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setRedistModal(null)}><div style={{background:'white',borderRadius:16,padding:24,maxWidth:600,width:'90%',maxHeight:'80vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}><h3 style={{fontSize:18,fontWeight:700,marginBottom:16}}>⚖ Redistribución</h3><div style={{maxHeight:300,overflowY:'auto',marginBottom:16}}>{redistItems.map(it=>(<label key={it.id} style={{display:'flex',gap:8,alignItems:'center',padding:8,borderRadius:6,border:'1px solid #e2e8f0',marginBottom:4,cursor:'pointer',background:redistSel.includes(it.id)?'#eef2ff':'white'}}><input type="checkbox" checked={redistSel.includes(it.id)} onChange={e=>{if(e.target.checked)setRedistSel(p=>[...p,it.id]);else setRedistSel(p=>p.filter(x=>x!==it.id));}}/><span style={{flex:1,fontSize:13}}>{it.label}</span><span style={{fontSize:12,fontWeight:700,color:'#059669'}}>{fmt(it.venta)}</span></label>))}</div><div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>setRedistModal(null)} style={{...sB('#6b7280'),fontSize:12}}>Cerrar</button></div></div></div>);};
  const renderConfig=()=>(<div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}><span style={{fontSize:24}}>⚙️</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Configuración</h2></div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      <label style={sL}>Nombre Cotización<input value={nomCot} onChange={e=>setNomCot(e.target.value)} style={sI} placeholder="Ej: Cotización Op NQN"/></label>
      <label style={sL}>Cliente<input value={cliente} onChange={e=>setCliente(e.target.value)} style={sI}/></label>
      <label style={sL}>Provincia<select value={prov} onChange={e=>setProv(e.target.value)} style={sI}>{PROVS.map(p=><option key={p}>{p}</option>)}</select></label>
      <label style={sL}>Mes<input type="month" value={mesCot} onChange={e=>setMesCot(e.target.value)} style={sI}/></label>
      <label style={sL}>Plazo (meses)<input type="number" value={plazo} onChange={e=>setPlazo(Number(e.target.value))} style={sI} min={1} max={60}/></label>
      <label style={sL}>Dólar<input type="number" value={dolar} onChange={e=>setDolar(Number(e.target.value))} style={sI} min={1}/></label>
    </div>
    <div style={{marginTop:20,padding:14,background:'#fff7ed',borderRadius:12,border:'1px solid #fed7aa'}}>
      <h3 style={{fontSize:14,fontWeight:700,color:'#c2410c',marginBottom:10}}>🏭 Negocio</h3>
      <div style={{display:'flex',gap:8}}>{NEGOCIOS.map(n=>(<button key={n} onClick={()=>setNegocio(n)} style={{padding:'8px 16px',borderRadius:8,border:negocio===n?'2px solid #c2410c':'1px solid #d1d5db',background:negocio===n?'#fff7ed':'white',fontWeight:negocio===n?700:500,fontSize:13,cursor:'pointer',color:negocio===n?'#c2410c':'#374151'}}>{n}</button>))}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:20}}>
      <div style={{padding:14,background:'#fef2f2',borderRadius:12,border:'1px solid #fecaca'}}>
        <h3 style={{fontSize:14,fontWeight:700,color:'#dc2626',marginBottom:10}}>⛽ Combustibles</h3>
        <label style={sL}>Nafta ($/lt)<input type="number" value={precioNafta} onChange={e=>setPrecioNafta(Number(e.target.value))} style={sI} min={0}/></label>
        <label style={{...sL,marginTop:8}}>Gasoil ($/lt)<input type="number" value={precioGasoil} onChange={e=>setPrecioGasoil(Number(e.target.value))} style={sI} min={0}/></label>
      </div>
      <div style={{padding:14,background:'#faf5ff',borderRadius:12,border:'1px solid #e9d5ff'}}>
        <h3 style={{fontSize:14,fontWeight:700,color:'#7c3aed',marginBottom:10}}>💼 Cargas Conc.Sal. Rem.</h3>
        <label style={sL}>% Adicional<input type="number" value={pctConcSalRem} onChange={e=>setPctConcSalRem(Number(e.target.value))} style={sI} min={0} max={100}/></label>
        <p style={{fontSize:11,color:'#6b7280',marginTop:6}}>Aplica sobre conceptos remunerativos dentro de cada puesto</p>
      </div>
    </div>
    <div style={{marginTop:20,padding:14,background:'#eff6ff',borderRadius:12,border:'1px solid #bfdbfe'}}>
      <h3 style={{fontSize:14,fontWeight:700,color:'#1d4ed8',marginBottom:6}}>📂 Fuente de datos</h3>
      <p style={{fontSize:12,color:'#1e40af'}}>Los datos maestros se cargan automáticamente desde el repositorio remoto. Para actualizarlos, editá los archivos en GitHub y usá el botón <b>↻ Recargar datos</b> en la barra superior.</p>
    </div>
    <div style={{marginTop:20,padding:14,background:'#f0fdf4',borderRadius:12,border:'1px solid #bbf7d0'}}>
      <h3 style={{fontSize:14,fontWeight:700,color:'#059669',marginBottom:10}}>🏛 Alícuotas Impositivas ({prov})</h3>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
        <label style={sL}>IIBB %<input type="number" step="0.1" value={iibbAlic} onChange={e=>setIibbAlic(Number(e.target.value))} style={sI}/><span style={{fontSize:10,color:'#6b7280'}}>Auto: {IIBB_ALIC[prov]||'N/D'}%</span></label>
        <label style={sL}>Sello %<input type="number" step="0.1" value={selloAlic} onChange={e=>setSelloAlic(Number(e.target.value))} style={sI}/></label>
        <label style={sL}>{otroImp.nombre||'Otro'} %<input type="number" step="0.1" value={otroImp.alic} onChange={e=>setOtroImp({...otroImp,alic:Number(e.target.value)})} style={sI}/></label>
      </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
      <div style={{padding:14,background:'#fef2f2',borderRadius:12,border:'1px solid #fecaca'}}>
        <h3 style={{fontSize:14,fontWeight:700,color:'#dc2626',marginBottom:8}}>🚑 Soporte Ambulancias</h3>
        {soporteAmb&&soporteAmb.length>0
          ? <p style={{fontSize:11,color:'#059669',fontWeight:600}}>✅ {soporteAmb.length} ítems disponibles desde GitHub</p>
          : <p style={{fontSize:11,color:'#92400e'}}>⚠ Sin datos remotos. Verificá moviles.json en el repo.</p>
        }
      </div>
      <div style={{padding:14,background:'#fffbeb',borderRadius:12,border:'1px solid #fde68a'}}>
        <h3 style={{fontSize:14,fontWeight:700,color:'#d97706',marginBottom:8}}>🏠 Soporte Trailers</h3>
        {soporteTrail&&soporteTrail.length>0
          ? <p style={{fontSize:11,color:'#059669',fontWeight:600}}>✅ {soporteTrail.length} ítems disponibles desde GitHub</p>
          : <p style={{fontSize:11,color:'#92400e'}}>⚠ Sin datos remotos. Verificá trailers.json en el repo.</p>
        }
      </div>
    </div>
    </div>
    <div style={{marginTop:20,padding:14,background:'#f0fdf4',borderRadius:12,border:'1px solid #bbf7d0'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
        {[{l:'CE',v:CE+'%'},{l:'Prov.',v:prov},{l:'USD',v:fmt(dolar)},{l:'Nafta',v:'$'+precioNafta},{l:'Gasoil',v:'$'+precioGasoil}].map(x=>(<div key={x.l} style={{padding:8,background:'white',borderRadius:8}}><span style={{color:'#6b7280',fontSize:12}}>{x.l}</span><div style={{fontWeight:700,fontSize:14,color:'#059669'}}>{x.v}</div></div>))}
      </div>
    </div>
  </div>);

  // 3️⃣ COTIZACIÓN - MU% rename
  const renderCot=()=>(<div>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>📋</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Líneas de Cotización</h2></div><button onClick={()=>setLineas([...lineas,{id:uid(),nombre:'',um:'MES',mu:15}])} style={sB('#7c3aed')}>+ Línea</button></div>
    <table style={sT}><thead><tr style={{background:'#f1f5f9'}}><th style={sTh}>#</th><th style={sTh}>Nombre</th><th style={sTh}>UM</th><th style={sTh}>MU%</th><th style={sTh}>Costo</th><th style={sTh}>Venta</th><th style={sTh}></th></tr></thead>
    <tbody>{lineas.map((l,i)=>{const c=totales.pL[l.id]?.c||0;return(<tr key={l.id} style={{borderBottom:'1px solid #e2e8f0'}}><td style={sTd}>{i+1}</td><td style={sTd}><input value={l.nombre} onChange={e=>{const n=[...lineas];n[i].nombre=e.target.value;setLineas(n);}} style={{...sIs,margin:0}}/></td><td style={sTd}><select value={l.um} onChange={e=>{const n=[...lineas];n[i].um=e.target.value;setLineas(n);}} style={{...sIs,margin:0,width:70}}><option>MES</option><option>UNI</option></select></td><td style={sTd}><input type="number" value={l.mu} onChange={e=>{const n=[...lineas];n[i].mu=Number(e.target.value);setLineas(n);}} style={{...sIs,margin:0,width:60,textAlign:'right'}}/></td><td style={{...sTd,fontWeight:600}}>{fmt(c)}</td><td style={{...sTd,fontWeight:700,color:'#059669'}}>{fmt(c*(1+l.mu/100))}</td><td style={sTd}><button onClick={()=>setLineas(lineas.filter(x=>x.id!==l.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>🗑</button></td></tr>);})}</tbody></table>
  </div>);

  // 2️⃣ PERSONAL - conceptos salariales PER PERSON (no global)
  const renderPersonal=()=>{
    const addP=()=>setPersonal([...personal,{id:uid(),tipo:'RD',convenio:'',categoria:'',puesto:'',diagrama:'7x7',qty:1,turno:'A',ad:{},viandas:VI_DEF.map(v=>({...v})),anios:0,pctN:0,horasExtra:[],conceptos:[],impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[]}]);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>👥</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Personal ({personal.length})</h2></div>
        <div style={{display:'flex',gap:8}}><button onClick={()=>{setRedistSel([]);setRedistModal({t:personal,s:setPersonal});}} style={{...sB('#059669'),fontSize:12}}>⚖ Redistribuir</button><button onClick={addP} style={sB('#2563eb')}>+ Personal</button></div>
      </div>
      <SubBar items={personal} calc={p=>calcP(p).c} color="#3b82f6" label="Subtotal Personal"/>
      {personal.map((p,idx)=>{const cc=calcP(p);const errs=validarP(p);return(
        <div key={p.id} style={{...sCard,borderLeft:errs.length>0?'4px solid #ef4444':'4px solid #3b82f6'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={()=>tExp(p.id)}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{background:p.tipo==='MT'?'#fef3c7':'#dbeafe',color:p.tipo==='MT'?'#92400e':'#2563eb',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:700}}>{p.tipo}</span><span style={{fontWeight:600}}>{p.puesto||'(puesto)'}</span>{p.convenio&&<span style={{color:'#6b7280',fontSize:12}}>({p.convenio}{p.categoria?' – '+p.categoria:''})</span>}<span style={{fontSize:12,color:'#6b7280'}}>×{p.qty}</span></div>
            <div style={{display:'flex',gap:12,alignItems:'center'}}>{errs.length>0&&<span style={{fontSize:11,color:'#ef4444'}}>⚠{errs.length}</span>}<span style={{fontWeight:700,color:'#059669',fontSize:16}}>{fmt(cc.c)}/mes</span><span style={{color:'#94a3b8'}}>{exp[p.id]?'▲':'▼'}</span></div>
          </div>
          {exp[p.id]&&(<div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
            {errs.length>0&&<div style={{padding:6,background:'#fef2f2',borderRadius:6,marginBottom:8,fontSize:11,color:'#dc2626'}}>{errs.join(' | ')}</div>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              <label style={sLs}>Tipo<select value={p.tipo} onChange={e=>{const n=[...personal];n[idx].tipo=e.target.value;if(e.target.value==='MT'){n[idx].convenio='';n[idx].categoria='';}setPersonal(n);}} style={sIs}><option value="RD">Rel. Dep.</option><option value="MT">Monotrib.</option></select></label>
              {p.tipo==='RD'&&<label style={sLs}>Convenio<select value={p.convenio} onChange={e=>{const n=[...personal];n[idx].convenio=e.target.value;n[idx].categoria='';n[idx].puesto='';setPersonal(n);}} style={sIs}><option value="">--</option>{CONV_RD.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></label>}
              {p.tipo==='RD'&&p.convenio&&<label style={sLs}>Categoría<select value={p.categoria} onChange={e=>{const n=[...personal];n[idx].categoria=e.target.value;n[idx].puesto='';setPersonal(n);}} style={sIs}><option value="">--</option>{(CATS_CONV[p.convenio]||[]).map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></label>}
              <label style={sLs}>Puesto<select value={p.puesto} onChange={e=>{const n=[...personal];n[idx].puesto=e.target.value;setPersonal(n);}} style={sIs}><option value="">--</option>{(PUESTOS[p.categoria||'Fuera de Convenio']||['Médico','Enfermero','Chofer','Chofermero']).map(pp=><option key={pp}>{pp}</option>)}</select></label>
              <label style={sLs}>Diagrama<select value={p.diagrama} onChange={e=>{const n=[...personal];n[idx].diagrama=e.target.value;setPersonal(n);}} style={sIs}>{DIAGRAMAS.map(dd=><option key={dd.id} value={dd.id}>{dd.label}</option>)}</select></label>
              <label style={sLs}>Qty<input type="number" value={p.qty} onChange={e=>{const n=[...personal];n[idx].qty=Math.max(1,Number(e.target.value));setPersonal(n);}} style={sIs} min={1}/></label>
              <label style={sLs}>Turno<select value={p.turno} onChange={e=>{const n=[...personal];n[idx].turno=e.target.value;setPersonal(n);}} style={sIs}><option>A</option><option>B</option><option value="Y">Y (Supl.)</option></select></label>
            </div>
            {p.puesto&&<div style={{marginTop:8,padding:6,background:'#f0f9ff',borderRadius:6,fontSize:12,display:'flex',gap:16}}><span>Bruto:<b>{fmt(cc.b)}</b></span><span>Cía:<b>{fmt(cc.c/(p.qty||1))}</b></span>{cc.vi>0&&<span>Vi:<b>{fmt(cc.vi)}</b></span>}{cc.he>0&&<span>HE:<b>{fmt(cc.he)}</b></span>}{cc.ccs>0&&<span>CS:<b>{fmt(cc.ccs)}</b></span>}</div>}
            {p.convenio==='FATSA'&&p.tipo==='RD'&&<div style={{marginTop:8,padding:8,background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff'}}><div style={{fontSize:12,fontWeight:700,color:'#7c3aed',marginBottom:4}}>FATSA</div><div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:12}}><label style={{display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" checked={p.ad?.pres||false} onChange={e=>{const n=[...personal];n[idx].ad={...n[idx].ad,pres:e.target.checked};setPersonal(n);}}/>Present.(8.33%)</label>{p.puesto==='Enfermero'&&<label style={{display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" checked={p.ad?.enf||false} onChange={e=>{const n=[...personal];n[idx].ad={...n[idx].ad,enf:e.target.checked};setPersonal(n);}}/>Enf.(15%)</label>}<label style={{display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" checked={p.ad?.noc||false} onChange={e=>{const n=[...personal];n[idx].ad={...n[idx].ad,noc:e.target.checked};setPersonal(n);}}/>Noct.(20%)</label>{p.ad?.noc&&<input type="number" value={p.pctN||0} onChange={e=>{const n=[...personal];n[idx].pctN=Math.min(100,Number(e.target.value));setPersonal(n);}} style={{width:45,padding:'2px 4px',borderRadius:4,border:'1px solid #d1d5db'}} min={0} max={100}/>}<label style={{display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" checked={p.ad?.ant||false} onChange={e=>{const n=[...personal];n[idx].ad={...n[idx].ad,ant:e.target.checked};setPersonal(n);}}/>Antig.</label>{p.ad?.ant&&<input type="number" value={p.anios||0} onChange={e=>{const n=[...personal];n[idx].anios=Math.min(30,Number(e.target.value));setPersonal(n);}} style={{width:40,padding:'2px 4px',borderRadius:4,border:'1px solid #d1d5db'}} min={0} max={30}/>}</div></div>}
            {p.convenio==='Petrolero'&&p.tipo==='RD'&&<div style={{marginTop:8,padding:8,background:'#fff7ed',borderRadius:8,border:'1px solid #fed7aa'}}><div style={{fontSize:12,fontWeight:700,color:'#c2410c',marginBottom:4}}>🍽️ Viandas</div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{(p.viandas||[]).map((v,vi)=>(<label key={vi} style={{display:'flex',gap:4,alignItems:'center',fontSize:12}}><input type="checkbox" checked={v.incluir} onChange={e=>{const n=[...personal];n[idx].viandas=[...n[idx].viandas];n[idx].viandas[vi]={...n[idx].viandas[vi],incluir:e.target.checked};setPersonal(n);}}/>{v.tipo}<input type="number" value={v.precio} onChange={e=>{const n=[...personal];n[idx].viandas=[...n[idx].viandas];n[idx].viandas[vi]={...n[idx].viandas[vi],precio:Number(e.target.value)};setPersonal(n);}} style={{width:75,padding:'2px',borderRadius:4,border:'1px solid #d1d5db',fontSize:11}}/></label>))}</div></div>}
            <div style={{marginTop:8,padding:8,background:'#fff1f2',borderRadius:8,border:'1px solid #fecdd3'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:12,fontWeight:700,color:'#be123c'}}>⏰ Horas Extra</span><button onClick={()=>{const n=[...personal];n[idx].horasExtra=[...(n[idx].horasExtra||[]),{id:uid(),tipo:'HE50',qty:0}];setPersonal(n);}} style={{fontSize:11,color:'#be123c',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>+HE</button></div>{(p.horasExtra||[]).map((he,hi)=>(<div key={he.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:3}}><select value={he.tipo} onChange={e=>{const n=[...personal];n[idx].horasExtra=[...n[idx].horasExtra];n[idx].horasExtra[hi]={...n[idx].horasExtra[hi],tipo:e.target.value};setPersonal(n);}} style={{padding:'3px',borderRadius:4,border:'1px solid #d1d5db',fontSize:12}}>{T_HE.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select><input type="number" value={he.qty} onChange={e=>{const n=[...personal];n[idx].horasExtra=[...n[idx].horasExtra];n[idx].horasExtra[hi]={...n[idx].horasExtra[hi],qty:Number(e.target.value)};setPersonal(n);}} style={{width:50,padding:'3px',borderRadius:4,border:'1px solid #d1d5db',fontSize:12}} min={0}/><button onClick={()=>{const n=[...personal];n[idx].horasExtra=n[idx].horasExtra.filter((_,j)=>j!==hi);setPersonal(n);}} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:12}}>✕</button></div>))}</div>
            <div style={{marginTop:8,padding:8,background:'#f5f3ff',borderRadius:8,border:'1px solid #ddd6fe'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>💼 Conceptos Salariales</span><button onClick={()=>{const n=[...personal];n[idx].conceptos=[...(n[idx].conceptos||[]),{id:uid(),nombre:'',qty:1,pu:0,rem:true}];setPersonal(n);}} style={{fontSize:11,color:'#7c3aed',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>+ Concepto</button></div><p style={{fontSize:10,color:'#6b7280',marginBottom:4}}>Rem: +{pctConcSalRem}% cargas | NoRem: suma directa</p>{(p.conceptos||[]).map((cs,ci)=>{const costoCs=cs.rem?(cs.qty||0)*(cs.pu||0)*(1+pctConcSalRem/100):(cs.qty||0)*(cs.pu||0);return(<div key={cs.id} style={{display:'flex',gap:4,alignItems:'center',marginBottom:3}}><input value={cs.nombre} onChange={e=>{const n=[...personal];n[idx].conceptos=[...n[idx].conceptos];n[idx].conceptos[ci]={...n[idx].conceptos[ci],nombre:e.target.value};setPersonal(n);}} style={{...sIs,flex:2}} placeholder="Concepto"/><input type="number" value={cs.qty} onChange={e=>{const n=[...personal];n[idx].conceptos=[...n[idx].conceptos];n[idx].conceptos[ci]={...n[idx].conceptos[ci],qty:Number(e.target.value)};setPersonal(n);}} style={{...sIs,width:40}} min={0}/><input type="number" value={cs.pu} onChange={e=>{const n=[...personal];n[idx].conceptos=[...n[idx].conceptos];n[idx].conceptos[ci]={...n[idx].conceptos[ci],pu:Number(e.target.value)};setPersonal(n);}} style={{...sIs,width:75}}/><select value={cs.rem?'r':'n'} onChange={e=>{const n=[...personal];n[idx].conceptos=[...n[idx].conceptos];n[idx].conceptos[ci]={...n[idx].conceptos[ci],rem:e.target.value==='r'};setPersonal(n);}} style={{...sIs,width:60,fontSize:11}}><option value="r">Rem</option><option value="n">NR</option></select><span style={{fontSize:11,fontWeight:700,color:'#059669',minWidth:55}}>{fmt(costoCs)}</span><button onClick={()=>{const n=[...personal];n[idx].conceptos=n[idx].conceptos.filter((_,j)=>j!==ci);setPersonal(n);}} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:12}}>✕</button></div>);})}</div>
            <ImpEd imps={p.impactos||[]} onChange={imp=>{const n=[...personal];n[idx].impactos=imp;setPersonal(n);}} items={personal} setItems={setPersonal}/>
            <div style={{textAlign:'right',marginTop:8}}><button onClick={()=>setPersonal(personal.filter(x=>x.id!==p.id))} style={{color:'#ef4444',background:'#fef2f2',border:'1px solid #fecaca',padding:'4px 12px',borderRadius:8,cursor:'pointer',fontSize:12}}>🗑 Eliminar</button></div>
          </div>)}
        </div>);})}
    </div>);};
  const renderCat=({titulo,emoji,items,setItems,defs,color,isCap=false})=>{
    const cargar=()=>{const nv=defs.map(dd=>({id:uid(),concepto:dd.c||dd.i||dd.t||dd.n||'',qty:1,precioUnit:dd.cu||dd.cm||dd.p||dd.ct||0,qTemp:dd.qt||dd.f||'Mensual',moneda:'ARS',impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[],...(isCap?{costoTotal:dd.ct||0,freq:dd.f||'Anual',dest:dd.dest||1}:{})}));setItems([...items,...nv]);};
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>{emoji}</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>{titulo} ({items.length})</h2></div>
        <div style={{display:'flex',gap:8}}><button onClick={cargar} style={{...sB('#6366f1'),fontSize:12}}>📥 Soporte</button><button onClick={()=>setItems([...items,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[],...(isCap?{costoTotal:0,freq:'Anual',dest:1}:{})}])} style={{...sB(color),fontSize:12}}>+</button></div>
      </div>
      <SubBar items={items} calc={isCap?cap=>(cap.costoTotal||0)*(Q_T[cap.freq]||1):cItem} color={color} label={'Sub. '+titulo}/>
      {items.map((it,idx)=>(<div key={it.id} style={sCard}><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{display:'grid',gridTemplateColumns:isCap?'2fr 1fr 1fr 1fr':'2fr 1fr 1fr 1fr 1fr',gap:8,flex:1}}>
          <label style={sLs}>Concepto<input value={it.concepto} onChange={e=>{const n=[...items];n[idx].concepto=e.target.value;setItems(n);}} style={sIs}/></label>
          {!isCap&&<><label style={sLs}>Qty<input type="number" value={it.qty} onChange={e=>{const n=[...items];n[idx].qty=Number(e.target.value);setItems(n);}} style={sIs}/></label><label style={sLs}>P.U.<input type="number" value={it.precioUnit} onChange={e=>{const n=[...items];n[idx].precioUnit=Number(e.target.value);setItems(n);}} style={sIs}/></label></>}
          {isCap&&<><label style={sLs}>C.Total<input type="number" value={it.costoTotal} onChange={e=>{const n=[...items];n[idx].costoTotal=Number(e.target.value);setItems(n);}} style={sIs}/></label><label style={sLs}>Freq<select value={it.freq} onChange={e=>{const n=[...items];n[idx].freq=e.target.value;setItems(n);}} style={sIs}>{Object.keys(Q_T).map(q=><option key={q}>{q}</option>)}</select></label><label style={sLs}>Dest.<input type="number" value={it.dest} onChange={e=>{const n=[...items];n[idx].dest=Number(e.target.value);setItems(n);}} style={sIs} min={1}/></label></>}
          {!isCap&&<label style={sLs}>QTemp<select value={it.qTemp} onChange={e=>{const n=[...items];n[idx].qTemp=e.target.value;setItems(n);}} style={sIs}>{Object.keys(Q_T).map(q=><option key={q}>{q}</option>)}</select></label>}
          <label style={sLs}>$<select value={it.moneda} onChange={e=>{const n=[...items];n[idx].moneda=e.target.value;setItems(n);}} style={sIs}><option>ARS</option><option>USD</option></select></label>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,marginLeft:10}}><span style={{fontWeight:700,color:'#059669',fontSize:14}}>{isCap?fmt((it.costoTotal||0)*(Q_T[it.freq]||1)):fmt(cItem(it))}/m</span><button onClick={()=>setItems(items.filter(x=>x.id!==it.id))} style={{color:'#ef4444',fontSize:11,background:'none',border:'none',cursor:'pointer'}}>🗑</button></div>
      </div><ImpEd imps={it.impactos||[]} onChange={imp=>{const n=[...items];n[idx].impactos=imp;setItems(n);}} items={items} setItems={setItems}/></div>))}
    </div>);};

  // AMBULANCIAS

  // ═══ 7️⃣ COMUNICACIÓN (nueva categoría) ═══
  const renderCom=()=>{
    const loadXL=()=>{const items=XL_COMS.filter(c=>c.m>0).map(c=>({id:uid(),concepto:c.i,qty:c.q,precioUnit:c.m,qTemp:'Mensual',moneda:'ARS',nota:`V:${fmt(c.v)} /${c.a}m`,impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[]}));setComunicacion([...comunicacion,...items]);};
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>📡</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Comunicación ({comunicacion.length})</h2></div><div style={{display:'flex',gap:6}}><button onClick={loadXL} style={{...sB('#0891b2'),fontSize:10}}>📥 Excel</button><button onClick={()=>setComunicacion([...comunicacion,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[]}])} style={{...sB('#0891b2'),fontSize:11}}>+</button></div></div>
      {comunicacion.length>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#ecfeff',borderRadius:6,marginBottom:8}}><span style={{fontSize:12,fontWeight:700,color:'#0891b2'}}>Total</span><span style={{fontSize:15,fontWeight:800,color:'#0891b2'}}>{fmt(comunicacion.reduce((s,it)=>s+cItem(it),0))}/m</span></div>}
      {comunicacion.map((it,idx)=>(<div key={it.id} style={{display:'flex',gap:4,alignItems:'center',padding:5,background:'white',borderRadius:5,border:'1px solid #e2e8f0',marginBottom:3,fontSize:11}}>
        <input value={it.concepto} onChange={e=>{const n=[...comunicacion];n[idx].concepto=e.target.value;setComunicacion(n);}} style={{...sIs,flex:2,fontSize:11}}/>
        <input type="number" value={it.qty} onChange={e=>{const n=[...comunicacion];n[idx].qty=Number(e.target.value);setComunicacion(n);}} style={{...sIs,width:40,fontSize:11}}/>
        <input type="number" value={it.precioUnit} onChange={e=>{const n=[...comunicacion];n[idx].precioUnit=Number(e.target.value);setComunicacion(n);}} style={{...sIs,width:75,fontSize:11}}/>
        <span style={{fontWeight:700,color:'#0891b2',minWidth:60}}>{fmt(cItem(it))}/m</span>
        {it.nota&&<span style={{fontSize:9,color:'#6b7280'}}>{it.nota}</span>}
        <button onClick={()=>setComunicacion(comunicacion.filter(x=>x.id!==it.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button>
      </div>))}
    </div>);};

  const renderAmb=()=>{
    const rW=()=>setAmbWiz({step:1,orig:'',tadq:'',tamb:'UTI'});
    const addD=m=>{setAmbulancias([...ambulancias,{...m,id:uid(),origen:'disp',impL:ambIG}]);rW();};
    // Adquisición: trae amortización/alquiler + EECC (costos asociados de Mantenimiento, hoja Ambulancias)
    // y kms editables para el combustible.
    const addA=(mod,tadq)=>{
      let cm=0;
      if(tadq==='Alquiler'){const a=d.ambAlq.find(x=>x.mod===mod);cm=a?.cm||0;}
      else{const c=d.ambCompra.find(x=>x.mod===mod);if(c)cm=(c.px-c.res)/(c.vu*12);}
      // EECC: costos asociados desde Mantenimiento (origen Ambulancias). P y qty editables.
      const eecc=getCostosEECC('Ambulancias','UTIM');
      setAmbulancias([...ambulancias,{
        id:uid(),mod,tipo:ambWiz.tamb,origen:'adq',tadq,cm,
        anio:ANIO_ACTUAL,impL:ambIG,
        kms:0,            // editable
        precioComb:precioGasoil,  // ref de Config
        rendKmL:3,        // km por litro (editable)
        eecc,             // array de costos asociados editables
        eeccOpen:false,
      }]);
      rW();
    };
    return(<div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}><span style={{fontSize:24}}>🚑</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Ambulancias ({ambulancias.length})</h2></div>
      <SubBar items={ambulancias} calc={a=>a.cm||0} color="#dc2626" label="Sub. Ambulancias"/>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:10,background:'#f0f9ff',borderRadius:8}}><span style={{fontSize:12,fontWeight:600,color:'#0369a1'}}>⟡ Impacto:</span><select value={ambIG} onChange={e=>setAmbIG(e.target.value)} style={{...sIs,flex:1}}><option value="">--</option>{lineas.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:12,padding:20,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:16}}>{[1,2,3].map(s=>(<React.Fragment key={s}><div style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,background:ambWiz.step>=s?'#3b82f6':'#e2e8f0',color:ambWiz.step>=s?'white':'#94a3b8'}}>{s}</div>{s<3&&<div style={{flex:1,height:3,background:ambWiz.step>s?'#3b82f6':'#e2e8f0'}}/>}</React.Fragment>))}</div>
        {ambWiz.step===1&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}><div onClick={()=>setAmbWiz({...ambWiz,step:2,orig:'disp'})} style={sWC('#f0fdf4','#bbf7d0')}><span style={{fontSize:34}}>✅</span><span style={{fontWeight:700}}>Disponible</span>{soporteAmb&&<span style={{fontSize:10,color:'#059669'}}>({soporteAmb.length} items)</span>}</div><div onClick={()=>setAmbWiz({...ambWiz,step:2,orig:'adq'})} style={sWC('#f0f9ff','#bae6fd')}><span style={{fontSize:34}}>📦</span><span style={{fontWeight:700}}>Adquisición</span></div></div>}
        {ambWiz.step===2&&ambWiz.orig==='disp'&&<div><button onClick={rW} style={{fontSize:12,color:'#3b82f6',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button>
          {soporteAmb&&soporteAmb.length>0?<div style={{maxHeight:350,overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:8}}><table style={{...sT,fontSize:10}}><thead><tr style={{background:'#dc2626'}}>{Object.keys(soporteAmb[0]).map(k=>(<th key={k} style={{...sTh,color:'white',fontSize:9,padding:4}}>{k}</th>))}</tr></thead><tbody>{soporteAmb.map((r,i)=>(<tr key={i} style={{borderBottom:'1px solid #fecaca',cursor:'pointer'}} onClick={()=>{setAmbulancias([...ambulancias,{id:uid(),mod:r.Modelo||r.Dominio||'Amb '+(i+1),tipo:r.Tipo||'UTI',origen:'disp',tadq:'',cm:0,anio:Number(r['Año']||ANIO_ACTUAL),dom:r.Dominio||'',interno:r.Interno||'',impL:ambIG}]);}}>{Object.values(r).map((v,j)=>(<td key={j} style={{padding:3,fontSize:9}}>{v!=null?(typeof v==='number'&&v>999?fmt(v):String(v)):''}</td>))}</tr>))}</tbody></table></div>:<div style={{padding:24,textAlign:'center',background:'#fef2f2',borderRadius:10,border:'1px dashed #fca5a5'}}><p style={{fontSize:15,fontWeight:700,color:'#dc2626'}}>Sin disponibilidad</p><p style={{fontSize:11,color:'#6b7280',marginTop:6}}>Sin móviles en Back Up. Verificá Dashboard_Moviles_OC en el repo.</p></div>}
        </div>}
        {ambWiz.step===2&&ambWiz.orig==='adq'&&<div><button onClick={rW} style={{fontSize:12,color:'#3b82f6',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}><div onClick={()=>setAmbWiz({...ambWiz,step:3,tadq:'Alquiler'})} style={sWC('#fffbeb','#fde68a')}><span style={{fontSize:34}}>🕐</span><span style={{fontWeight:700}}>Alquiler</span></div><div onClick={()=>setAmbWiz({...ambWiz,step:3,tadq:'Compra'})} style={sWC('#faf5ff','#e9d5ff')}><span style={{fontSize:34}}>💰</span><span style={{fontWeight:700}}>Compra</span></div></div></div>}
        {ambWiz.step===3&&<div><button onClick={()=>setAmbWiz({...ambWiz,step:2})} style={{fontSize:12,color:'#3b82f6',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button><div style={{display:'grid',gap:8}}>{(ambWiz.tadq==='Alquiler'?d.ambAlq:d.ambCompra).map((m,i)=>(<div key={i} onClick={()=>addA(m.mod,ambWiz.tadq)} style={{display:'flex',justifyContent:'space-between',padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',cursor:'pointer'}}><span>{m.mod}</span><span style={{fontWeight:700,color:'#059669'}}>{fmt(m.cm||((m.px-m.res)/(m.vu*12)))}/m</span></div>))}</div></div>}
      </div>
      {ambulancias.map((a,idx)=>{
        const isAdq=a.origen==='adq';
        const combMensual=isAdq?((a.kms||0)/Math.max(a.rendKmL||3,0.1))*(a.precioComb||0):0;
        const eeccTotal=isAdq&&a.eecc?a.eecc.reduce((s,e)=>s+(e.qty||1)*(e.precioUnit||0),0):0;
        const totalMensual=(a.cm||0)+combMensual+eeccTotal;
        const mult=plazo||1;
        return(<div key={a.id} style={{background:'white',borderRadius:8,border:'1px solid #e2e8f0',marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',padding:12,alignItems:'center'}}>
            <div><span style={{fontWeight:600}}>{a.mod}</span><span style={{fontSize:11,color:'#6b7280',marginLeft:8}}>{a.origen==='disp'?'✅ Disponible':'📦 '+a.tadq}{a.anio?' | '+antAnios(a.anio)+'a':''}</span></div>
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              {isAdq&&<button onClick={()=>{const n=[...ambulancias];n[idx].eeccOpen=!n[idx].eeccOpen;setAmbulancias(n);}} style={{fontSize:10,padding:'2px 8px',borderRadius:4,border:'1px solid #dc2626',background:a.eeccOpen?'#fef2f2':'white',color:'#dc2626',cursor:'pointer',fontWeight:700}}>{a.eeccOpen?'▼':'▶'} EECC</button>}
              <select value={a.impL||''} onChange={e=>{const n=[...ambulancias];n[idx].impL=e.target.value;setAmbulancias(n);}} style={{...sIs,width:140}}><option value="">Global</option>{lineas.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
              <div style={{textAlign:'right'}}><span style={{fontWeight:700,color:'#059669'}}>{fmt(totalMensual)}/m</span><div style={{fontSize:9,color:'#8b5cf6'}}>{fmt(totalMensual*mult)} ({mult}m)</div></div>
              <button onClick={()=>setAmbulancias(ambulancias.filter(x=>x.id!==a.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button>
            </div>
          </div>
          {isAdq&&a.eeccOpen&&<div style={{padding:12,borderTop:'1px solid #fecaca',background:'#fef9f9'}}>
            {/* Amortización / Alquiler */}
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:8,padding:6,background:'white',borderRadius:6}}><span style={{fontWeight:700,color:'#dc2626'}}>{a.tadq==='Alquiler'?'Alquiler mensual':'Amortización mensual'}</span><span style={{fontWeight:700}}>{fmt(a.cm)}/m</span></div>
            {/* Combustible con kms editable */}
            <div style={{display:'flex',gap:6,alignItems:'center',fontSize:10,marginBottom:8,padding:6,background:'white',borderRadius:6}}>
              <span style={{fontWeight:700,color:'#dc2626',flex:1}}>⛽ Combustible</span>
              <span>Kms/mes:</span><input type="number" value={a.kms} onChange={e=>{const n=[...ambulancias];n[idx].kms=Number(e.target.value);setAmbulancias(n);}} style={{...sIs,width:70,fontSize:10}}/>
              <span>Km/L:</span><input type="number" value={a.rendKmL} onChange={e=>{const n=[...ambulancias];n[idx].rendKmL=Number(e.target.value);setAmbulancias(n);}} style={{...sIs,width:45,fontSize:10}}/>
              <span>$/L:</span><input type="number" value={a.precioComb} onChange={e=>{const n=[...ambulancias];n[idx].precioComb=Number(e.target.value);setAmbulancias(n);}} style={{...sIs,width:60,fontSize:10}}/>
              <span style={{fontWeight:700,color:'#059669',minWidth:70,textAlign:'right'}}>{fmt(combMensual)}/m</span>
            </div>
            {/* EECC: costos asociados de Mantenimiento, P y qty editables, eliminar filas */}
            <div style={{fontSize:10,fontWeight:700,color:'#dc2626',marginBottom:4}}>Costos asociados (EECC) — {a.eecc?.length||0} ítems</div>
            <div style={{display:'flex',gap:4,padding:'2px 4px',fontSize:9,fontWeight:700,color:'#64748b'}}><span style={{flex:2}}>Ítem</span><span style={{width:45}}>Qty</span><span style={{width:75}}>P.unit</span><span style={{width:60}}>Mensual</span><span style={{width:20}}></span></div>
            {(a.eecc||[]).map((e,ei)=>(<div key={e.id} style={{display:'flex',gap:4,alignItems:'center',padding:3,background:'white',borderRadius:4,marginBottom:2,fontSize:10}}>
              <input value={e.item} onChange={ev=>{const n=[...ambulancias];n[idx].eecc[ei].item=ev.target.value;setAmbulancias(n);}} style={{...sIs,flex:2,fontSize:9}}/>
              <input type="number" value={e.qty} onChange={ev=>{const n=[...ambulancias];n[idx].eecc[ei].qty=Number(ev.target.value);setAmbulancias(n);}} style={{...sIs,width:45,fontSize:9}}/>
              <input type="number" value={e.precioUnit} onChange={ev=>{const n=[...ambulancias];n[idx].eecc[ei].precioUnit=Number(ev.target.value);setAmbulancias(n);}} style={{...sIs,width:75,fontSize:9}}/>
              <span style={{fontWeight:700,color:'#059669',width:60,fontSize:9}}>{fmt((e.qty||1)*(e.precioUnit||0))}</span>
              <button onClick={()=>{const n=[...ambulancias];n[idx].eecc=n[idx].eecc.filter(x=>x.id!==e.id);setAmbulancias(n);}} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:11,width:20}}>✕</button>
            </div>))}
            <button onClick={()=>{const n=[...ambulancias];n[idx].eecc=[...(n[idx].eecc||[]),{id:uid(),item:'',qty:1,precioUnit:0}];setAmbulancias(n);}} style={{fontSize:10,color:'#dc2626',background:'none',border:'1px dashed #fca5a5',borderRadius:4,padding:'2px 8px',cursor:'pointer',marginTop:4}}>+ Agregar costo</button>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:8,padding:6,background:'#fef2f2',borderRadius:6,fontSize:11}}><span style={{fontWeight:700,color:'#dc2626'}}>Total EECC</span><span style={{fontWeight:800,color:'#dc2626'}}>{fmt(eeccTotal)}/m</span></div>
          </div>}
        </div>);
      })}
      <div style={{marginTop:20,padding:14,background:'#fef2f2',borderRadius:12,border:'1px solid #fecaca'}}>
        
<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><h3 style={{fontSize:16,fontWeight:700,color:'#dc2626'}}>🚗 EECC Móviles</h3><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{xlMovEeccs.map(ec=>{const cnt=XL_MOVS.filter(m=>m.ec===ec).length;return(<button key={ec} onClick={()=>{setMovEecc(ec);setMovilesXL(XL_MOVS.filter(m=>m.ec===ec).map(m=>({id:uid(),eecc:m.ec,tipo:m.tp,clasif:m.cl,desc:m.de,incluir:m.in,vu:m.vu,qty:m.qt,vm:m.vm,impactos:[]})));}} style={{padding:'4px 10px',borderRadius:6,border:movEecc===ec?'2px solid #dc2626':'1px solid #fca5a5',background:movEecc===ec?'#fef2f2':'white',fontWeight:movEecc===ec?700:400,fontSize:11,cursor:'pointer'}}>{ec} ({cnt})</button>);})}</div></div>
        {movilesXL.length>0&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:8}}><div style={{padding:6,background:'#fff7ed',borderRadius:6}}><div style={{fontSize:10,color:'#c2410c'}}>CAPEX</div><div style={{fontSize:14,fontWeight:800,color:'#c2410c'}}>{fmt(movilesXL.filter(m=>m.tipo==='Capex').reduce((s,m)=>s+(m.vm||0),0))}</div></div><div style={{padding:6,background:'#f0fdf4',borderRadius:6}}><div style={{fontSize:10,color:'#059669'}}>OPEX</div><div style={{fontSize:14,fontWeight:800,color:'#059669'}}>{fmt(movilesXL.filter(m=>m.tipo==='Opex').reduce((s,m)=>s+(m.vm||0),0))}</div></div><div style={{padding:6,background:'#eef2ff',borderRadius:6}}><div style={{fontSize:10,color:'#4338ca'}}>TOTAL</div><div style={{fontSize:14,fontWeight:800,color:'#4338ca'}}>{fmt(movilesXL.reduce((s,m)=>s+(m.vm||0),0))}</div></div></div>
        <table style={{...sT,fontSize:10}}><thead><tr style={{background:'#f1f5f9'}}><th style={{...sTh,fontSize:9,padding:3}}>✓</th><th style={{...sTh,fontSize:9,padding:3}}>Tipo</th><th style={{...sTh,fontSize:9,padding:3}}>Descripción</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>V.Unit</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'center'}}>Qty</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Mensual</th></tr></thead>
        <tbody>{movilesXL.map((m,idx)=>(<tr key={m.id} style={{borderBottom:'1px solid #f1f5f9',opacity:m.incluir?1:0.4}}>
          <td style={{padding:2,textAlign:'center'}}><input type="checkbox" checked={m.incluir===1} onChange={e=>{const n=[...movilesXL];n[idx].incluir=e.target.checked?1:0;n[idx].vm=e.target.checked?n[idx].vu/Math.max(n[idx].qty,1):0;setMovilesXL(n);}}/></td>
          <td style={{padding:2}}><span style={{fontSize:8,padding:'1px 3px',borderRadius:3,background:m.tipo==='Capex'?'#fff7ed':'#f0fdf4',color:m.tipo==='Capex'?'#c2410c':'#059669'}}>{m.tipo}</span></td>
          <td style={{padding:2,fontSize:9}} title={m.clasif}>{m.desc}</td>
          <td style={{padding:2,textAlign:'right'}}><input type="number" value={m.vu} onChange={e=>{const n=[...movilesXL];n[idx].vu=Number(e.target.value);n[idx].vm=n[idx].incluir?n[idx].vu/Math.max(n[idx].qty,1):0;setMovilesXL(n);}} style={{width:65,padding:'1px',borderRadius:3,border:'1px solid #e2e8f0',fontSize:9,textAlign:'right'}}/></td>
          <td style={{padding:2,textAlign:'center',fontSize:9}}>{m.qty}</td>
          <td style={{padding:2,textAlign:'right',fontWeight:700,color:m.tipo==='Capex'?'#c2410c':'#059669',fontSize:10}}>{fmt(m.vm)}</td>
        </tr>))}</tbody></table></>}
      </div>
    </div>);};

  // 6️⃣ TRAILERS + EECC subcategoría
  const renderTr=()=>{
    const rW=()=>setTrWiz({step:1,orig:'',tadq:'',tipo:''});
    const addD=t=>{setTrailers([...trailers,{...t,id:uid(),origen:'disp',impL:trIG}]);rW();};
    const addA=(mod,tadq,tipo)=>{
      let cm=0;
      if(tadq==='Alquiler'){const a=d.trAlq.find(x=>x.mod===mod);cm=a?.cm||0;}
      else{const c=d.trCompra.find(x=>x.mod===mod);if(c)cm=(c.px-c.res)/(c.vu*12);}
      // EECC desde Mantenimiento (origen Trailers). P y qty editables.
      const eecc=getCostosEECC('Trailers',null);
      setTrailers([...trailers,{
        id:uid(),mod,tipo,origen:'adq',tadq,cm,anio:ANIO_ACTUAL,impL:trIG,
        kms:0,precioComb:precioGasoil,rendKmL:3,eecc,eeccOpen:false,
      }]);
      rW();
    };
    return(<div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}><span style={{fontSize:24}}>🏠</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Trailers ({trailers.length})</h2></div>
      <SubBar items={trailers} calc={t=>cTr(t)} color="#d97706" label="Sub. Trailers"/>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,padding:10,background:'#f0f9ff',borderRadius:8}}><span style={{fontSize:12,fontWeight:600,color:'#0369a1'}}>⟡ Impacto:</span><select value={trIG} onChange={e=>setTrIG(e.target.value)} style={{...sIs,flex:1}}><option value="">--</option>{lineas.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</select></div>
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:12,padding:20,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:16}}>{[1,2,3,4].map(s=>(<React.Fragment key={s}><div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12,background:trWiz.step>=s?'#d97706':'#e2e8f0',color:trWiz.step>=s?'white':'#94a3b8'}}>{s}</div>{s<4&&<div style={{flex:1,height:3,background:trWiz.step>s?'#d97706':'#e2e8f0'}}/>}</React.Fragment>))}</div>
        {trWiz.step===1&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}><div onClick={()=>setTrWiz({...trWiz,step:2,tipo:'Sanitario'})} style={sWC('#f0fdf4','#bbf7d0')}><span style={{fontSize:34}}>🏥</span><span style={{fontWeight:700}}>Sanitario</span></div><div onClick={()=>setTrWiz({...trWiz,step:2,tipo:'Habitacional'})} style={sWC('#fffbeb','#fde68a')}><span style={{fontSize:34}}>🏠</span><span style={{fontWeight:700}}>Habitacional</span></div></div>}
        {trWiz.step===2&&<div><button onClick={rW} style={{fontSize:12,color:'#d97706',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}><div onClick={()=>setTrWiz({...trWiz,step:3,orig:'disp'})} style={sWC('#f0fdf4','#bbf7d0')}><span style={{fontSize:34}}>✅</span><span style={{fontWeight:700}}>Disponible</span>{soporteTrail&&<span style={{fontSize:10,color:'#059669'}}>({soporteTrail.length} items)</span>}</div><div onClick={()=>setTrWiz({...trWiz,step:3,orig:'adq'})} style={sWC('#f0f9ff','#bae6fd')}><span style={{fontSize:34}}>📦</span><span style={{fontWeight:700}}>Adquisición</span></div></div></div>}
        {trWiz.step===3&&trWiz.orig==='disp'&&<div><button onClick={()=>setTrWiz({...trWiz,step:2})} style={{fontSize:12,color:'#d97706',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button>
          {soporteTrail&&soporteTrail.length>0?<div style={{maxHeight:350,overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:8}}><table style={{...sT,fontSize:10}}><thead><tr style={{background:'#d97706'}}>{Object.keys(soporteTrail[0]).map(k=>(<th key={k} style={{...sTh,color:'white',fontSize:9,padding:4}}>{k}</th>))}</tr></thead><tbody>{soporteTrail.map((r,i)=>(<tr key={i} style={{borderBottom:'1px solid #fde68a',cursor:'pointer'}} onClick={()=>{setTrailers([...trailers,{id:uid(),mod:r.Modelo||r.Dominio||'Trailer '+(i+1),tipo:r.Tipo||'',cat:'Disponible',origen:'disp',neg:negocio,cm:Number(r.CostoMensual||0),impL:trIG}]);}}>{Object.values(r).map((v,j)=>(<td key={j} style={{padding:3,fontSize:9}}>{v!=null?(typeof v==='number'&&v>999?fmt(v):String(v)):''}</td>))}</tr>))}</tbody></table></div>:<div style={{padding:24,textAlign:'center',background:'#fffbeb',borderRadius:10,border:'1px dashed #fbbf24'}}><p style={{fontSize:15,fontWeight:700,color:'#d97706'}}>Sin disponibilidad</p><p style={{fontSize:11,color:'#6b7280',marginTop:6}}>Sin trailers disponibles. Verificá Dashboard_Moviles_OC en el repo.</p></div>}
        </div>}
        {trWiz.step===3&&trWiz.orig==='adq'&&<div><button onClick={()=>setTrWiz({...trWiz,step:2})} style={{fontSize:12,color:'#d97706',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}><div onClick={()=>setTrWiz({...trWiz,step:4,tadq:'Alquiler'})} style={sWC('#fffbeb','#fde68a')}><span style={{fontSize:34}}>🕐</span><span style={{fontWeight:700}}>Alquiler</span></div><div onClick={()=>setTrWiz({...trWiz,step:4,tadq:'Compra'})} style={sWC('#faf5ff','#e9d5ff')}><span style={{fontSize:34}}>💰</span><span style={{fontWeight:700}}>Compra</span></div></div></div>}
        {trWiz.step===4&&<div><button onClick={()=>setTrWiz({...trWiz,step:3})} style={{fontSize:12,color:'#d97706',background:'none',border:'none',cursor:'pointer',marginBottom:10}}>← Volver</button><div style={{display:'grid',gap:8}}>{(trWiz.tadq==='Alquiler'?d.trAlq:d.trCompra).filter(t=>t.tipo===trWiz.tipo).map((t,i)=>(<div key={i} onClick={()=>addA(t.mod,trWiz.tadq,trWiz.tipo)} style={{display:'flex',justifyContent:'space-between',padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',cursor:'pointer'}}><span>{t.mod}</span><span style={{fontWeight:700,color:'#059669'}}>{fmt(t.cm||((t.px-t.res)/(t.vu*12)))}/m</span></div>))}</div></div>}
      </div>
      {trailers.map((t,idx)=>{
        const isAdq=t.origen==='adq';
        const combMensual=isAdq?((t.kms||0)/Math.max(t.rendKmL||3,0.1))*(t.precioComb||0):0;
        const eeccTotal=isAdq&&t.eecc?t.eecc.reduce((s,e)=>s+(e.qty||1)*(e.precioUnit||0),0):0;
        const totalMensual=cTr(t);const mult=plazo||1;
        return(<div key={t.id} style={{background:'white',borderRadius:6,border:'1px solid #e2e8f0',marginBottom:4}}>
          <div style={{display:'flex',justifyContent:'space-between',padding:8,fontSize:12,alignItems:'center'}}>
            <div><span style={{fontWeight:600}}>{t.mod||t.concepto||'—'}</span>{t.origen&&<span style={{fontSize:10,color:'#6b7280',marginLeft:6}}>{t.tipo}|{t.origen==='disp'?'✅ Disp':'📦 '+t.tadq}</span>}{t.cat&&<span style={{fontSize:9,color:'#92400e',marginLeft:6,background:'#fef3c7',padding:'1px 4px',borderRadius:3}}>{t.cat}</span>}</div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {isAdq&&<button onClick={()=>{const n=[...trailers];n[idx].eeccOpen=!n[idx].eeccOpen;setTrailers(n);}} style={{fontSize:10,padding:'2px 8px',borderRadius:4,border:'1px solid #d97706',background:t.eeccOpen?'#fffbeb':'white',color:'#d97706',cursor:'pointer',fontWeight:700}}>{t.eeccOpen?'▼':'▶'} EECC</button>}
              {!isAdq&&<input type="number" value={t.cm} onChange={e=>{const n=[...trailers];n[idx].cm=Number(e.target.value);setTrailers(n);}} style={{width:80,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontSize:11,textAlign:'right'}}/>}
              <div style={{textAlign:'right'}}><span style={{fontWeight:700,color:'#059669',fontSize:12}}>{fmt(totalMensual)}/m</span><div style={{fontSize:9,color:'#8b5cf6'}}>{fmt(totalMensual*mult)} ({mult}m)</div></div>
              <button onClick={()=>setTrailers(trailers.filter(x=>x.id!==t.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button>
            </div>
          </div>
          {isAdq&&t.eeccOpen&&<div style={{padding:12,borderTop:'1px solid #fde68a',background:'#fffdf7'}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:8,padding:6,background:'white',borderRadius:6}}><span style={{fontWeight:700,color:'#d97706'}}>{t.tadq==='Alquiler'?'Alquiler mensual':'Amortización mensual'}</span><input type="number" value={t.cm} onChange={e=>{const n=[...trailers];n[idx].cm=Number(e.target.value);setTrailers(n);}} style={{width:90,padding:'2px 4px',borderRadius:4,border:'1px solid #e2e8f0',fontSize:11,textAlign:'right'}}/></div>
            <div style={{display:'flex',gap:6,alignItems:'center',fontSize:10,marginBottom:8,padding:6,background:'white',borderRadius:6}}>
              <span style={{fontWeight:700,color:'#d97706',flex:1}}>⛽ Combustible</span>
              <span>Kms/mes:</span><input type="number" value={t.kms} onChange={e=>{const n=[...trailers];n[idx].kms=Number(e.target.value);setTrailers(n);}} style={{...sIs,width:70,fontSize:10}}/>
              <span>Km/L:</span><input type="number" value={t.rendKmL} onChange={e=>{const n=[...trailers];n[idx].rendKmL=Number(e.target.value);setTrailers(n);}} style={{...sIs,width:45,fontSize:10}}/>
              <span>$/L:</span><input type="number" value={t.precioComb} onChange={e=>{const n=[...trailers];n[idx].precioComb=Number(e.target.value);setTrailers(n);}} style={{...sIs,width:60,fontSize:10}}/>
              <span style={{fontWeight:700,color:'#059669',minWidth:70,textAlign:'right'}}>{fmt(combMensual)}/m</span>
            </div>
            <div style={{fontSize:10,fontWeight:700,color:'#d97706',marginBottom:4}}>Costos asociados (EECC) — {t.eecc?.length||0} ítems</div>
            <div style={{display:'flex',gap:4,padding:'2px 4px',fontSize:9,fontWeight:700,color:'#64748b'}}><span style={{flex:2}}>Ítem</span><span style={{width:45}}>Qty</span><span style={{width:75}}>P.unit</span><span style={{width:60}}>Mensual</span><span style={{width:20}}></span></div>
            {(t.eecc||[]).map((e,ei)=>(<div key={e.id} style={{display:'flex',gap:4,alignItems:'center',padding:3,background:'white',borderRadius:4,marginBottom:2,fontSize:10}}>
              <input value={e.item} onChange={ev=>{const n=[...trailers];n[idx].eecc[ei].item=ev.target.value;setTrailers(n);}} style={{...sIs,flex:2,fontSize:9}}/>
              <input type="number" value={e.qty} onChange={ev=>{const n=[...trailers];n[idx].eecc[ei].qty=Number(ev.target.value);setTrailers(n);}} style={{...sIs,width:45,fontSize:9}}/>
              <input type="number" value={e.precioUnit} onChange={ev=>{const n=[...trailers];n[idx].eecc[ei].precioUnit=Number(ev.target.value);setTrailers(n);}} style={{...sIs,width:75,fontSize:9}}/>
              <span style={{fontWeight:700,color:'#059669',width:60,fontSize:9}}>{fmt((e.qty||1)*(e.precioUnit||0))}</span>
              <button onClick={()=>{const n=[...trailers];n[idx].eecc=n[idx].eecc.filter(x=>x.id!==e.id);setTrailers(n);}} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:11,width:20}}>✕</button>
            </div>))}
            <button onClick={()=>{const n=[...trailers];n[idx].eecc=[...(n[idx].eecc||[]),{id:uid(),item:'',qty:1,precioUnit:0}];setTrailers(n);}} style={{fontSize:10,color:'#d97706',background:'none',border:'1px dashed #fbbf24',borderRadius:4,padding:'2px 8px',cursor:'pointer',marginTop:4}}>+ Agregar costo</button>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:8,padding:6,background:'#fffbeb',borderRadius:6,fontSize:11}}><span style={{fontWeight:700,color:'#d97706'}}>Total EECC</span><span style={{fontWeight:800,color:'#d97706'}}>{fmt(eeccTotal)}/m</span></div>
          </div>}
        </div>);
      })}
      <div style={{marginTop:16,padding:12,background:'#fffbeb',borderRadius:10,border:'1px solid #fde68a'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}><h3 style={{fontSize:15,fontWeight:700,color:'#d97706'}}>🔧 EECC Trailers</h3></div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>{[...new Set(XL_TRAIL.map(t=>t.cat))].map(cat=>{const items=XL_TRAIL.filter(t=>t.cat===cat);return(<button key={cat} onClick={()=>{const its=items.map(t=>({id:uid(),concepto:t.i,cat:t.cat,neg:t.neg,cm:t.vm,vc:t.vc,meses:t.m,impL:trIG}));setTrailers([...trailers,...its]);}} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #fbbf24',background:'white',fontSize:10,cursor:'pointer',color:'#92400e'}}>📥 {cat} ({items.length})</button>);})}</div>
        <table style={{...sT,fontSize:10}}><thead><tr style={{background:'#fffbeb'}}><th style={{...sTh,fontSize:9,padding:3}}>Cat.</th><th style={{...sTh,fontSize:9,padding:3}}>Item</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>V.Compra</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'center'}}>Meses</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Mensual</th></tr></thead>
        <tbody>{XL_TRAIL.map((t,i)=>(<tr key={i} style={{borderBottom:'1px solid #fef3c7'}}><td style={{padding:2,fontSize:8}}><span style={{background:'#fef3c7',padding:'1px 3px',borderRadius:2}}>{t.cat}</span></td><td style={{padding:2,fontSize:9}}>{t.i}</td><td style={{padding:2,textAlign:'right',fontSize:9}}>{t.vc>0?fmt(t.vc):'-'}</td><td style={{padding:2,textAlign:'center',fontSize:9}}>{t.m}</td><td style={{padding:2,textAlign:'right',fontWeight:700,color:'#d97706',fontSize:10}}>{fmt(t.vm)}</td></tr>))}</tbody>
        <tfoot><tr style={{background:'#fef3c7'}}><td colSpan={4} style={{padding:3,fontWeight:700,fontSize:10}}>Total EECC</td><td style={{padding:3,textAlign:'right',fontWeight:800,color:'#d97706',fontSize:11}}>{fmt(XL_TRAIL.reduce((s,t)=>s+t.vm,0))}/m</td></tr></tfoot></table>
      </div>
    </div>);};


  // 4️⃣ BACKUP - nueva lógica redistribución por peso de venta
  const renderBk=()=>{
    const addBk=()=>setPersonalBk([...personalBk,{id:uid(),tipo:'RD',convenio:'',categoria:'',puesto:'',diagrama:'7x7',qty:1,turno:'Y',ad:{},viandas:VI_DEF.map(v=>({...v,incluir:false})),anios:0,pctN:0,horasExtra:[],conceptos:[]}]);
    const toggleLid=(lid)=>{const lids=bkRedist.lids.includes(lid)?bkRedist.lids.filter(x=>x!==lid):[...bkRedist.lids,lid];setBkRedist({...bkRedist,lids});};
    const selVenta=bkRedist.lids.reduce((s,lid)=>{const c=totales.pL[lid]?.c||0;return s+c*(1+(totales.pL[lid]?.mu||15)/100);},0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>🔄</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Personal Backup ({personalBk.length})</h2></div><button onClick={addBk} style={sB('#6366f1')}>+ Backup</button></div>
      <div style={{fontSize:12,color:'#6b7280',marginBottom:10,padding:8,background:'#eef2ff',borderRadius:8}}>El costo de Backup se redistribuye automáticamente por peso de venta a las líneas seleccionadas.</div>
      <SubBar items={personalBk} calc={p=>calcP(p).c} color="#6366f1" label="Sub. Backup"/>
      {personalBk.map((p,idx)=>{const cc=calcP(p);return(<div key={p.id} style={{...sCard,borderLeft:'4px solid #6366f1'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{background:'#e0e7ff',color:'#4338ca',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:700}}>BK</span><span style={{fontWeight:600}}>{p.puesto||'(puesto)'}</span></div><div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{fontWeight:700,color:'#059669'}}>{fmt(cc.c)}/m</span><button onClick={()=>setPersonalBk(personalBk.filter(x=>x.id!==p.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button></div></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:10}}>
          <label style={sLs}>Tipo<select value={p.tipo} onChange={e=>{const n=[...personalBk];n[idx].tipo=e.target.value;setPersonalBk(n);}} style={sIs}><option value="RD">RD</option><option value="MT">MT</option></select></label>
          {p.tipo==='RD'&&<label style={sLs}>Conv.<select value={p.convenio} onChange={e=>{const n=[...personalBk];n[idx].convenio=e.target.value;n[idx].categoria='';setPersonalBk(n);}} style={sIs}><option value="">--</option>{CONV_RD.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></label>}
          {p.tipo==='RD'&&p.convenio&&<label style={sLs}>Cat.<select value={p.categoria} onChange={e=>{const n=[...personalBk];n[idx].categoria=e.target.value;setPersonalBk(n);}} style={sIs}><option value="">--</option>{(CATS_CONV[p.convenio]||[]).map(c=><option key={c.v} value={c.v}>{c.l}</option>)}</select></label>}
          <label style={sLs}>Puesto<select value={p.puesto} onChange={e=>{const n=[...personalBk];n[idx].puesto=e.target.value;setPersonalBk(n);}} style={sIs}><option value="">--</option>{(PUESTOS[p.categoria||'Fuera de Convenio']||['Médico','Enfermero','Chofer','Chofermero']).map(pp=><option key={pp}>{pp}</option>)}</select></label>
          <label style={sLs}>Qty<input type="number" value={p.qty} onChange={e=>{const n=[...personalBk];n[idx].qty=Number(e.target.value);setPersonalBk(n);}} style={sIs} min={1}/></label>
          <label style={sLs}>Diag.<select value={p.diagrama} onChange={e=>{const n=[...personalBk];n[idx].diagrama=e.target.value;setPersonalBk(n);}} style={sIs}>{DIAGRAMAS.map(dd=><option key={dd.id} value={dd.id}>{dd.label}</option>)}</select></label>
        </div></div>);})}
      {bkTotalCost>0&&<div style={{marginTop:14,padding:14,background:'#ede9fe',borderRadius:12,border:'1px solid #c4b5fd'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><h3 style={{fontSize:14,fontWeight:700,color:'#5b21b6'}}>Redistribuir Costo de Backup: {fmt(bkTotalCost)}/m</h3>
          <label style={{display:'flex',gap:6,alignItems:'center',fontSize:12}}><input type="checkbox" checked={bkRedist.on} onChange={e=>setBkRedist({...bkRedist,on:e.target.checked})}/> Activar</label></div>
        {bkRedist.on&&<>{lineas.length===0&&<div style={{color:'#dc2626',fontSize:12,fontWeight:700}}>⚠ No hay líneas en Cotización</div>}
          <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>Seleccioná las líneas. La redistribución es automática por peso de venta.</div>
          {lineas.map(l=>{const c=totales.pL[l.id]?.c||0;const v=c*(1+l.mu/100);const sel=bkRedist.lids.includes(l.id);const peso=selVenta>0?(v/selVenta*100).toFixed(1):'0';const monto=selVenta>0?bkTotalCost*(v/selVenta):0;return(<label key={l.id} style={{display:'flex',gap:8,alignItems:'center',padding:8,background:sel?'#f5f3ff':'white',borderRadius:6,border:sel?'2px solid #7c3aed':'1px solid #e2e8f0',marginBottom:4,cursor:'pointer'}}>
            <input type="checkbox" checked={sel} onChange={()=>toggleLid(l.id)}/>
            <span style={{flex:1,fontSize:13,fontWeight:sel?700:400}}>{l.nombre}</span>
            <span style={{fontSize:11,color:'#6b7280'}}>Vta: {fmt(v)}</span>
            {sel&&<><span style={{fontSize:11,color:'#7c3aed',fontWeight:700}}>{peso}%</span><span style={{fontSize:12,fontWeight:700,color:'#059669'}}>+{fmt(monto)}</span></>}
          </label>);})}
          {bkRedist.lids.length>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#d4d4f8',borderRadius:6,marginTop:6}}><span style={{fontSize:12,fontWeight:700}}>100% redistribuido en {bkRedist.lids.length} línea(s)</span><span style={{fontSize:13,fontWeight:800,color:'#5b21b6'}}>{fmt(bkTotalCost)}/m</span></div>}
          {bkRedist.lids.length===0&&<div style={{color:'#dc2626',fontSize:12,fontWeight:700,marginTop:4}}>⚠ Seleccioná al menos una línea</div>}
        </>}
      </div>}
    </div>);};

  // ═══ 1️⃣ MEDICAMENTOS (compact + multipaquete + impacto global) ═══
  const xlMedMasters=useMemo(()=>[...new Set(XL_MEDS.map(m=>m.cl))].filter(Boolean),[]);
  const xlMedNeg=useMemo(()=>XL_MEDS.filter(m=>{const ng=negocio.toUpperCase();return m.n.toUpperCase().includes(ng.replace('Ó','O'))||ng==='OPERACIONES DEDICADAS'&&m.n.toUpperCase().includes('PETROL');}),  [negocio]);
  const [medPaqs,setMedPaqs]=useState([]);
  const renderMed=()=>{
    const togglePaq=(master)=>{const has=medPaqs.includes(master);const np=has?medPaqs.filter(p=>p!==master):[...medPaqs,master];setMedPaqs(np);const items=[];np.forEach(pq=>{xlMedNeg.filter(m=>m.cl===pq).forEach(m=>{if(!medicamentos.find(x=>x.nombre===m.i&&x.cat===pq))items.push({id:uid(),nombre:m.i,cat:pq,unidad:m.p,dosis:m.d,pu:m.u,qty:m.q,qTemp:'Mensual',impactos:[]});});});if(!has)setMedicamentos([...medicamentos,...xlMedNeg.filter(m=>m.cl===master).map(m=>({id:uid(),nombre:m.i,cat:master,unidad:m.p,dosis:m.d,pu:m.u,qty:m.q,qTemp:'Mensual',impactos:[]}))]);else setMedicamentos(medicamentos.filter(m=>m.cat!==master));};
    const medTotal=medicamentos.reduce((s,m)=>s+cMed(m),0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>💊</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Medicación ({medicamentos.length})</h2></div><button onClick={()=>setMedicamentos([...medicamentos,{id:uid(),nombre:'',cat:'Manual',unidad:'',dosis:'',pu:0,qty:1,qTemp:'Mensual',impactos:[]}])} style={{...sB('#e11d48'),fontSize:11}}>+ Manual</button></div>
      <div style={{padding:10,background:'#fdf2f8',borderRadius:8,border:'1px solid #fbcfe8',marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:'#be185d',marginBottom:6}}>📋 Master Medicación ({negocio})</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{xlMedMasters.map(m=>{const cnt=xlMedNeg.filter(x=>x.cl===m).length;const sel=medPaqs.includes(m);return(<button key={m} onClick={()=>togglePaq(m)} style={{padding:'4px 10px',borderRadius:6,border:sel?'2px solid #be185d':'1px solid #f9a8d4',background:sel?'#fce7f3':'white',fontWeight:sel?700:400,fontSize:11,cursor:'pointer',color:sel?'#be185d':'#374151'}}>{sel?'✓ ':''}{m} ({cnt})</button>);})}</div>
      </div>
      {medTotal>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#fce7f3',borderRadius:6,marginBottom:8}}><span style={{fontSize:13,fontWeight:700,color:'#be185d'}}>Total Medicación</span><span style={{fontSize:16,fontWeight:800,color:'#be185d'}}>{fmt(medTotal)}/m</span></div>}
      <ImpG imps={medImpG} setImps={setMedImpG} total={medTotal} color="#e11d48" label="Impacto Global Medicación"/>
      {medPaqs.map(pq=>{const items=medicamentos.filter(m=>m.cat===pq);if(!items.length)return null;return(<div key={pq} style={{marginTop:8}}><div style={{fontSize:12,fontWeight:700,color:'#be185d',padding:'3px 8px',background:'#fdf2f8',borderRadius:4,marginBottom:4}}>{pq} ({items.length})</div>
        <table style={{...sT,fontSize:10}}><thead><tr style={{background:'#fdf2f8'}}><th style={{...sTh,fontSize:9,padding:3}}>Item</th><th style={{...sTh,fontSize:9,padding:3}}>Dosis</th><th style={{...sTh,fontSize:9,padding:3}}>Pres.</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Qty</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>P.U.</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Total</th><th style={{...sTh,fontSize:9,padding:3}}></th></tr></thead>
        <tbody>{items.map((med,idx)=>{const gi=medicamentos.indexOf(med);return(<tr key={med.id} style={{borderBottom:'1px solid #fce7f3'}}>
          <td style={{padding:2}}><input value={med.nombre} onChange={e=>{const n=[...medicamentos];n[gi].nombre=e.target.value;setMedicamentos(n);}} style={{border:'none',fontSize:10,width:'100%',background:'transparent'}}/></td>
          <td style={{padding:2,fontSize:9,color:'#6b7280'}}>{med.dosis}</td><td style={{padding:2,fontSize:9,color:'#6b7280'}}>{med.unidad}</td>
          <td style={{padding:2,textAlign:'right'}}><input type="number" value={med.qty} onChange={e=>{const n=[...medicamentos];n[gi].qty=Number(e.target.value);setMedicamentos(n);}} style={{width:35,border:'none',fontSize:10,textAlign:'right',background:'transparent'}}/></td>
          <td style={{padding:2,textAlign:'right'}}><input type="number" value={med.pu} onChange={e=>{const n=[...medicamentos];n[gi].pu=Number(e.target.value);setMedicamentos(n);}} style={{width:55,border:'none',fontSize:10,textAlign:'right',background:'transparent'}}/></td>
          <td style={{padding:2,textAlign:'right',fontWeight:700,color:'#e11d48'}}>{fmt(cMed(med))}</td>
          <td style={{padding:2}}><button onClick={()=>setMedicamentos(medicamentos.filter(x=>x.id!==med.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button></td>
        </tr>);})}</tbody></table></div>);})}
      {medicamentos.filter(m=>m.cat==='Manual').length>0&&<div style={{marginTop:8}}><div style={{fontSize:12,fontWeight:600,marginBottom:4}}>Manuales</div>{medicamentos.filter(m=>m.cat==='Manual').map(med=>{const gi=medicamentos.indexOf(med);return(<div key={med.id} style={{display:'flex',gap:4,alignItems:'center',fontSize:11,padding:4,background:'white',borderRadius:4,border:'1px solid #e2e8f0',marginBottom:2}}>
        <input value={med.nombre} onChange={e=>{const n=[...medicamentos];n[gi].nombre=e.target.value;setMedicamentos(n);}} style={{...sIs,flex:2,fontSize:10}}/>
        <input type="number" value={med.qty} onChange={e=>{const n=[...medicamentos];n[gi].qty=Number(e.target.value);setMedicamentos(n);}} style={{...sIs,width:35,fontSize:10}}/>
        <input type="number" value={med.pu} onChange={e=>{const n=[...medicamentos];n[gi].pu=Number(e.target.value);setMedicamentos(n);}} style={{...sIs,width:60,fontSize:10}}/>
        <span style={{fontWeight:700,color:'#e11d48',fontSize:10}}>{fmt(cMed(med))}</span>
        <button onClick={()=>setMedicamentos(medicamentos.filter(x=>x.id!==med.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button>
      </div>);})}</div>}
    </div>);};

  // ═══ 2️⃣ UNIFORME (Excel: Uniforme Nuevo) ═══
  const xlUniNegs=useMemo(()=>{
    const nmap={'Petróleo':['PETROLEO','PETROLEO 2'],'Minería':['MINERIA'],'Operaciones dedicadas':['OPERACIONES DEDICADAS']};
    return nmap[negocio]||['PETROLEO'];
  },[negocio]);
  const renderUni=()=>{
    const loadUni=(neg)=>{const items=XL_UNIS.filter(u=>u.n===neg).map(u=>({id:uid(),nombre:u.i,entregas:u.e,unitario:u.u,totalAnual:u.ta,tm:u.tm,neg:u.n,impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[]}));setUniforme([...uniforme,...items]);};
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>👕</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Uniforme y EPP ({uniforme.length})</h2></div><button onClick={()=>setUniforme([...uniforme,{id:uid(),nombre:'',entregas:1,unitario:0,totalAnual:0,tm:0,neg:'',impactos:[]}])} style={{...sB('#8b5cf6'),fontSize:12}}>+ Manual</button></div>
      <div style={{padding:12,background:'#faf5ff',borderRadius:10,border:'1px solid #e9d5ff',marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:'#7c3aed',marginBottom:8}}>📥 Cargar desde Excel ({negocio})</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{xlUniNegs.map(n=>{const cnt=XL_UNIS.filter(u=>u.n===n).length;return(<button key={n} onClick={()=>loadUni(n)} style={{...sB('#7c3aed'),fontSize:11}}>{n} ({cnt} ítems)</button>);})}</div>
      </div>
      <SubBar items={uniforme} calc={u=>u.tm||0} color="#8b5cf6" label="Sub. Uniforme"/>
      {uniforme.map((u,idx)=>(<div key={u.id} style={{...sCard,padding:10}}><div style={{display:'flex',gap:6,alignItems:'center'}}>
        <input value={u.nombre} onChange={e=>{const n=[...uniforme];n[idx].nombre=e.target.value;setUniforme(n);}} style={{...sIs,flex:2}}/>
        <label style={{fontSize:11}}>Ent:<input type="number" value={u.entregas} onChange={e=>{const n=[...uniforme];n[idx].entregas=Number(e.target.value);n[idx].totalAnual=n[idx].unitario*n[idx].entregas;n[idx].tm=n[idx].totalAnual/12;setUniforme(n);}} style={{...sIs,width:40}} min={1}/></label>
        <label style={{fontSize:11}}>P.U:<input type="number" value={u.unitario} onChange={e=>{const n=[...uniforme];n[idx].unitario=Number(e.target.value);n[idx].totalAnual=n[idx].unitario*n[idx].entregas;n[idx].tm=n[idx].totalAnual/12;setUniforme(n);}} style={{...sIs,width:75}}/></label>
        <span style={{fontSize:10,color:'#6b7280'}}>Anual:{fmt(u.totalAnual)}</span>
        <span style={{fontWeight:700,color:'#7c3aed',fontSize:12,minWidth:70}}>{fmt(u.tm)}/m</span>
        <button onClick={()=>setUniforme(uniforme.filter(x=>x.id!==u.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button>
      </div><ImpEd imps={u.impactos||[]} onChange={imp=>{const n=[...uniforme];n[idx].impactos=imp;setUniforme(n);}}/></div>))}
    </div>);};

  // ═══ 3️⃣ EECC MÓVILES (Excel: Moviles Nuevo) ═══
  const xlMovEeccs=useMemo(()=>[...new Set(XL_MOVS.map(m=>m.ec))].filter(e=>e&&!e.includes('LOGISTICA')),[]);
  const xlMovLogEeccs=useMemo(()=>[...new Set(XL_MOVS.map(m=>m.ec))].filter(e=>e&&e.includes('LOGISTICA')),[]);
  const renderMov=()=>{
    const loadEecc=(ec)=>{setMovEecc(ec);const items=XL_MOVS.filter(m=>m.ec===ec).map(m=>({id:uid(),eecc:m.ec,tipo:m.tp,clasif:m.cl,desc:m.de,incluir:m.in,vu:m.vu,qty:m.qt,vm:m.vm,impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[]}));setMovilesXL(items);};
    const totCapex=movilesXL.filter(m=>m.tipo==='Capex').reduce((s,m)=>s+(m.vm||0),0);
    const totOpex=movilesXL.filter(m=>m.tipo==='Opex').reduce((s,m)=>s+(m.vm||0),0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>🚗</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>EECC Móviles ({movilesXL.length})</h2></div></div>
      <div style={{padding:10,background:'#fef2f2',borderRadius:10,border:'1px solid #fecaca',marginBottom:12}}>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{xlMovEeccs.map(ec=>{const cnt=XL_MOVS.filter(m=>m.ec===ec).length;return(<button key={ec} onClick={()=>loadEecc(ec)} style={{padding:'5px 12px',borderRadius:6,border:movEecc===ec?'2px solid #dc2626':'1px solid #fca5a5',background:movEecc===ec?'#fef2f2':'white',fontWeight:movEecc===ec?700:500,fontSize:11,cursor:'pointer',color:movEecc===ec?'#dc2626':'#374151'}}>{ec} ({cnt})</button>);})}</div>
      </div>
      {movilesXL.length>0&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}><div style={{padding:8,background:'#fff7ed',borderRadius:6}}><div style={{fontSize:10,color:'#c2410c'}}>CAPEX</div><div style={{fontSize:16,fontWeight:800,color:'#c2410c'}}>{fmt(totCapex)}/m</div></div><div style={{padding:8,background:'#f0fdf4',borderRadius:6}}><div style={{fontSize:10,color:'#059669'}}>OPEX</div><div style={{fontSize:16,fontWeight:800,color:'#059669'}}>{fmt(totOpex)}/m</div></div><div style={{padding:8,background:'#eef2ff',borderRadius:6}}><div style={{fontSize:10,color:'#4338ca'}}>TOTAL</div><div style={{fontSize:16,fontWeight:800,color:'#4338ca'}}>{fmt(totCapex+totOpex)}/m</div></div></div>
      <table style={{...sT,fontSize:11}}><thead><tr style={{background:'#f1f5f9'}}><th style={{...sTh,fontSize:10,padding:4}}>✓</th><th style={{...sTh,fontSize:10,padding:4}}>Tipo</th><th style={{...sTh,fontSize:10,padding:4}}>Descripción</th><th style={{...sTh,fontSize:10,padding:4,textAlign:'right'}}>V.Unit</th><th style={{...sTh,fontSize:10,padding:4,textAlign:'center'}}>Qty</th><th style={{...sTh,fontSize:10,padding:4,textAlign:'right'}}>Mensual</th></tr></thead>
      <tbody>{movilesXL.map((m,idx)=>(<tr key={m.id} style={{borderBottom:'1px solid #f1f5f9',background:m.incluir?'white':'#fafafa',opacity:m.incluir?1:0.5}}>
        <td style={{padding:3,textAlign:'center'}}><input type="checkbox" checked={m.incluir===1} onChange={e=>{const n=[...movilesXL];n[idx].incluir=e.target.checked?1:0;n[idx].vm=e.target.checked?n[idx].vu/Math.max(n[idx].qty,1):0;setMovilesXL(n);}}/></td>
        <td style={{padding:3}}><span style={{fontSize:9,padding:'1px 4px',borderRadius:3,background:m.tipo==='Capex'?'#fff7ed':'#f0fdf4',color:m.tipo==='Capex'?'#c2410c':'#059669'}}>{m.tipo}</span></td>
        <td style={{padding:3,fontSize:10,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={m.clasif+' – '+m.desc}>{m.desc}</td>
        <td style={{padding:3,textAlign:'right'}}><input type="number" value={m.vu} onChange={e=>{const n=[...movilesXL];n[idx].vu=Number(e.target.value);n[idx].vm=n[idx].incluir?n[idx].vu/Math.max(n[idx].qty,1):0;setMovilesXL(n);}} style={{width:70,padding:'1px 3px',borderRadius:3,border:'1px solid #e2e8f0',fontSize:10,textAlign:'right'}}/></td>
        <td style={{padding:3,textAlign:'center',fontSize:10}}>{m.qty}</td>
        <td style={{padding:3,textAlign:'right',fontWeight:700,color:m.tipo==='Capex'?'#c2410c':'#059669',fontSize:11}}>{fmt(m.vm)}</td>
      </tr>))}</tbody></table></>}
    </div>);};

  // ═══ 4️⃣ LOGÍSTICA (Excel formulas) + Redistribución Multilínea ═══
  const renderLog=()=>{const logT=logCalc.reduce((s,l)=>s+l.v,0);return(<div>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>🚛</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Logística</h2></div><button onClick={()=>setLogistica([...logistica,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[]}])} style={{...sB('#0891b2'),fontSize:12}}>+ Manual</button></div>
    <div style={{display:'flex',gap:6,marginBottom:12}}>{[{id:'traslado',l:'🚐 Traslado tradicional'},{id:'autorrelevo',l:'🔄 Autorrelevo'},{id:'butaca',l:'💺 Alquiler Butaca'}].map(m=>(<button key={m.id} onClick={()=>setLogMode(m.id)} style={{padding:'6px 14px',borderRadius:8,border:logMode===m.id?'2px solid #0891b2':'1px solid #e2e8f0',background:logMode===m.id?'#ecfeff':'white',fontWeight:logMode===m.id?700:400,fontSize:12,cursor:'pointer',color:logMode===m.id?'#0891b2':'#374151'}}>{m.l}</button>))}</div>
    {logMode==='autorrelevo'&&<div style={{padding:12,background:'#fff7ed',borderRadius:10,border:'1px solid #fed7aa',marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:'#c2410c',marginBottom:8}}>🔄 Autorrelevo</div>
      <div style={{display:'flex',gap:8,marginBottom:8}}>{[{id:'horas',l:'Hs viaje × Tarifa'},{id:'plus',l:'Plus fijo'}].map(t=>(<button key={t.id} onClick={()=>setLogAuto({...logAuto,tipo:t.id})} style={{padding:'4px 10px',borderRadius:6,border:logAuto.tipo===t.id?'2px solid #c2410c':'1px solid #fed7aa',background:logAuto.tipo===t.id?'#fff7ed':'white',fontWeight:logAuto.tipo===t.id?700:400,fontSize:11,cursor:'pointer'}}>{t.l}</button>))}</div>
      {logAuto.tipo==='horas'?<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
        <label style={sLs}>Hs viaje<input type="number" value={logAuto.horas} onChange={e=>setLogAuto({...logAuto,horas:Number(e.target.value)})} style={sIs}/></label>
        <label style={sLs}>Tarifa/h<input type="number" value={logAuto.tarifa} onChange={e=>setLogAuto({...logAuto,tarifa:Number(e.target.value)})} style={sIs}/></label>
        <div style={{padding:8,background:'white',borderRadius:6}}><div style={{fontSize:10,color:'#6b7280'}}>Total</div><div style={{fontSize:16,fontWeight:800,color:'#c2410c'}}>{fmt(logAuto.horas*logAuto.tarifa)}/m</div></div>
      </div>:<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <label style={sLs}>Plus fijo<input type="number" value={logAuto.plus} onChange={e=>setLogAuto({...logAuto,plus:Number(e.target.value)})} style={sIs}/></label>
        <div style={{padding:8,background:'white',borderRadius:6}}><div style={{fontSize:10,color:'#6b7280'}}>Total</div><div style={{fontSize:16,fontWeight:800,color:'#c2410c'}}>{fmt(logAuto.plus)}/m</div></div>
      </div>}
    </div>}
    {logMode==='butaca'&&<div style={{padding:12,background:'#faf5ff',borderRadius:10,border:'1px solid #e9d5ff',marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:'#7c3aed',marginBottom:8}}>💺 Alquiler Butaca</div>
      <div style={{display:'flex',gap:6,marginBottom:8}}>{[{id:'atego',l:'Atego',def:450000},{id:'minibus',l:'Minibus',def:380000},{id:'camioneta',l:'Camioneta alquilada',def:320000}].map(t=>(<button key={t.id} onClick={()=>setLogButaca({tipo:t.id,tarifa:t.def})} style={{padding:'4px 10px',borderRadius:6,border:logButaca.tipo===t.id?'2px solid #7c3aed':'1px solid #e9d5ff',background:logButaca.tipo===t.id?'#faf5ff':'white',fontWeight:logButaca.tipo===t.id?700:400,fontSize:11,cursor:'pointer'}}>{t.l}</button>))}</div>
      {logButaca.tipo&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <label style={sLs}>Tarifa/mes<input type="number" value={logButaca.tarifa} onChange={e=>setLogButaca({...logButaca,tarifa:Number(e.target.value)})} style={sIs}/></label>
        <div style={{padding:8,background:'white',borderRadius:6}}><div style={{fontSize:10,color:'#6b7280'}}>Total</div><div style={{fontSize:16,fontWeight:800,color:'#7c3aed'}}>{fmt(logButaca.tarifa)}/m</div></div>
      </div>}
    </div>}
    {logExtraCost>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#ecfeff',borderRadius:6,marginBottom:8}}><span style={{fontSize:12,fontWeight:700,color:'#0891b2'}}>Costo modalidad ({logMode})</span><span style={{fontSize:15,fontWeight:800,color:'#0891b2'}}>{fmt(logExtraCost)}/m</span></div>}
    <div style={{padding:12,background:'#f0f9ff',borderRadius:10,border:'1px solid #bae6fd',marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:'#0369a1',marginBottom:8}}>📊 Parámetros</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>{logParams.map((p,i)=>(<label key={i} style={{...sLs,fontSize:10}}>{p.p}<input type="number" value={p.v} onChange={e=>{const n=[...logParams];n[i]={...n[i],v:Number(e.target.value)};setLogParams(n);}} style={{...sIs,fontSize:11}}/></label>))}</div>
    </div>
    <div style={{padding:12,background:'#ecfdf5',borderRadius:10,border:'1px solid #a7f3d0',marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:'#059669',marginBottom:6}}>📋 Costos Calculados</div>
      <div style={{fontSize:10,color:'#6b7280',marginBottom:4}}>Chofer=(Chofer×Inc)/Sem/Pers | Vehíc=(Vehíc×Inc)/Sem/Pers | Comb=(Km×(Rot+Viajes)/KmTanque)×(LtTanque×$Lt)/Pers</div>
      {logCalc.map((lc,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',padding:8,background:'white',borderRadius:6,marginBottom:3}}><span style={{fontWeight:600,fontSize:12}}>{lc.cl}</span><span style={{fontWeight:700,color:'#059669',fontSize:14}}>{fmt(lc.v)}/m</span></div>))}
      <div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#d1fae5',borderRadius:6,marginTop:3}}><span style={{fontWeight:700,fontSize:13}}>Total</span><span style={{fontWeight:800,color:'#059669',fontSize:15}}>{fmt(logT)}/m</span></div>
    </div>
    <div style={{marginTop:12,padding:12,background:'#ecfeff',borderRadius:10,border:'1px solid #a5f3fc'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}><h3 style={{fontSize:14,fontWeight:700,color:'#0891b2'}}>🚗 EECC Móvil Logística</h3><div style={{display:'flex',gap:6}}>{xlMovLogEeccs.map(ec=>{const cnt=XL_MOVS.filter(m=>m.ec===ec).length;return(<button key={ec} onClick={()=>{setLogMovEc(ec);setLogMovXL(XL_MOVS.filter(m=>m.ec===ec).map(m=>({id:uid(),eecc:m.ec,tipo:m.tp,desc:m.de,incluir:m.in,vu:m.vu,qty:m.qt,vm:m.vm})));}} style={{padding:'3px 8px',borderRadius:5,border:logMovEc===ec?'2px solid #0891b2':'1px solid #a5f3fc',background:logMovEc===ec?'#ecfeff':'white',fontWeight:logMovEc===ec?700:400,fontSize:10,cursor:'pointer'}}>{ec} ({cnt})</button>);})}</div></div>
      {logMovXL.length>0&&<><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:6}}><div style={{padding:5,background:'#fff7ed',borderRadius:5}}><div style={{fontSize:9,color:'#c2410c'}}>CAPEX</div><div style={{fontSize:13,fontWeight:800,color:'#c2410c'}}>{fmt(logMovXL.filter(m=>m.tipo==='Capex').reduce((s,m)=>s+(m.vm||0),0))}</div></div><div style={{padding:5,background:'#f0fdf4',borderRadius:5}}><div style={{fontSize:9,color:'#059669'}}>OPEX</div><div style={{fontSize:13,fontWeight:800,color:'#059669'}}>{fmt(logMovXL.filter(m=>m.tipo==='Opex').reduce((s,m)=>s+(m.vm||0),0))}</div></div><div style={{padding:5,background:'#eef2ff',borderRadius:5}}><div style={{fontSize:9,color:'#4338ca'}}>TOTAL</div><div style={{fontSize:13,fontWeight:800,color:'#4338ca'}}>{fmt(logMovXL.reduce((s,m)=>s+(m.vm||0),0))}</div></div></div>
      <table style={{...sT,fontSize:10}}><thead><tr style={{background:'#ecfeff'}}><th style={{...sTh,fontSize:9,padding:3}}>✓</th><th style={{...sTh,fontSize:9,padding:3}}>Tipo</th><th style={{...sTh,fontSize:9,padding:3}}>Descripción</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>V.Unit</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'center'}}>Qty</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Mensual</th></tr></thead>
      <tbody>{logMovXL.map((m,idx)=>(<tr key={m.id} style={{borderBottom:'1px solid #e0f2fe',opacity:m.incluir?1:0.4}}>
        <td style={{padding:2,textAlign:'center'}}><input type="checkbox" checked={m.incluir===1} onChange={e=>{const n=[...logMovXL];n[idx].incluir=e.target.checked?1:0;n[idx].vm=e.target.checked?n[idx].vu/Math.max(n[idx].qty,1):0;setLogMovXL(n);}}/></td>
        <td style={{padding:2}}><span style={{fontSize:8,padding:'1px 3px',borderRadius:3,background:m.tipo==='Capex'?'#fff7ed':'#f0fdf4',color:m.tipo==='Capex'?'#c2410c':'#059669'}}>{m.tipo}</span></td>
        <td style={{padding:2,fontSize:9}}>{m.desc}</td>
        <td style={{padding:2,textAlign:'right'}}><input type="number" value={m.vu} onChange={e=>{const n=[...logMovXL];n[idx].vu=Number(e.target.value);n[idx].vm=n[idx].incluir?n[idx].vu/Math.max(n[idx].qty,1):0;setLogMovXL(n);}} style={{width:65,padding:'1px',borderRadius:3,border:'1px solid #e2e8f0',fontSize:9,textAlign:'right'}}/></td>
        <td style={{padding:2,textAlign:'center',fontSize:9}}>{m.qty}</td>
        <td style={{padding:2,textAlign:'right',fontWeight:700,color:m.tipo==='Capex'?'#c2410c':'#059669',fontSize:10}}>{fmt(m.vm)}</td>
      </tr>))}</tbody></table></>}
    </div>
    <ImpG imps={logImpG} setImps={setLogImpG} total={logT+logistica.reduce((s,l)=>s+cItem(l),0)+logMovXL.reduce((s,m)=>s+(m.vm||0),0)} color="#0891b2" label="Impacto Global Logística"/>
    {logistica.length>0&&<div style={{marginTop:10}}><div style={{fontSize:12,fontWeight:600,marginBottom:6}}>Ítems Adicionales</div>{logistica.map((lg,idx)=>(<div key={lg.id} style={{display:'flex',gap:4,alignItems:'center',padding:6,background:'white',borderRadius:6,border:'1px solid #e2e8f0',marginBottom:3,fontSize:12}}>
      <input value={lg.concepto} onChange={e=>{const n=[...logistica];n[idx].concepto=e.target.value;setLogistica(n);}} style={{...sIs,flex:2}} placeholder="Concepto"/>
      <input type="number" value={lg.qty} onChange={e=>{const n=[...logistica];n[idx].qty=Number(e.target.value);setLogistica(n);}} style={{...sIs,width:45}}/>
      <input type="number" value={lg.precioUnit} onChange={e=>{const n=[...logistica];n[idx].precioUnit=Number(e.target.value);setLogistica(n);}} style={{...sIs,width:75}}/>
      <span style={{fontWeight:700,color:'#059669',minWidth:60}}>{fmt(cItem(lg))}/m</span>
      <button onClick={()=>setLogistica(logistica.filter(x=>x.id!==lg.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button>
    </div>))}</div>}
  </div>);};

  // ═══ 5️⃣ OTROS COSTOS (compact + impacto global) ═══
  const renderOtros=()=>{
    const otrosT=otrosCostos.reduce((s,it)=>s+cItem(it),0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>💰</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Otros Costos ({otrosCostos.length})</h2></div><button onClick={()=>setOtrosCostos([...otrosCostos,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[]}])} style={{...sB('#059669'),fontSize:11}}>+ Agregar</button></div>
      {otrosT>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#ecfdf5',borderRadius:6,marginBottom:8}}><span style={{fontSize:12,fontWeight:700,color:'#059669'}}>Total</span><span style={{fontSize:15,fontWeight:800,color:'#059669'}}>{fmt(otrosT)}/m</span></div>}
      <ImpG imps={otrosImpG} setImps={setOtrosImpG} total={otrosT} color="#059669" label="Impacto Global Otros Costos"/>
      {otrosCostos.map((it,idx)=>(<div key={it.id} style={{display:'flex',gap:4,alignItems:'center',padding:5,background:'white',borderRadius:5,border:'1px solid #e2e8f0',marginBottom:3,fontSize:11}}>
        <input value={it.concepto} onChange={e=>{const n=[...otrosCostos];n[idx].concepto=e.target.value;setOtrosCostos(n);}} style={{...sIs,flex:2,fontSize:11}}/>
        <input type="number" value={it.qty} onChange={e=>{const n=[...otrosCostos];n[idx].qty=Number(e.target.value);setOtrosCostos(n);}} style={{...sIs,width:40,fontSize:11}}/>
        <input type="number" value={it.precioUnit} onChange={e=>{const n=[...otrosCostos];n[idx].precioUnit=Number(e.target.value);setOtrosCostos(n);}} style={{...sIs,width:75,fontSize:11}}/>
        <span style={{fontWeight:700,color:'#059669',minWidth:60}}>{fmt(cItem(it))}/m</span>
        {it.nota&&<span style={{fontSize:9,color:'#6b7280'}}>{it.nota}</span>}
        <button onClick={()=>setOtrosCostos(otrosCostos.filter(x=>x.id!==it.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button>
      </div>))}
    </div>);};

  // ═══ 6️⃣ EQUIPAMIENTO (Excel: Consultorio) ═══
  const xlConsNegs=useMemo(()=>[...new Set(XL_CONS.map(c=>c.n))],[]);
  const xlConsTipos=useMemo(()=>[...new Set(XL_CONS.map(c=>c.t))].filter(Boolean),[]);
  const renderEquip=()=>{
    const loadPaq=(neg,tipo)=>{const items=XL_CONS.filter(c=>c.n===neg&&(!tipo||c.t===tipo)).map(c=>({id:uid(),concepto:c.i,qty:c.q||1,precioUnit:c.am||0,qTemp:'Mensual',moneda:'ARS',cu:c.cu,ct:c.ct,qm:c.qm,amort:c.am,negOrig:c.n,tipoOrig:c.t,impactos:[]}));setEquipamiento([...equipamiento,...items]);};
    const eqT=equipamiento.reduce((s,it)=>s+cItem(it),0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>🔧</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Equip. Consultorio ({equipamiento.length})</h2></div><button onClick={()=>setEquipamiento([...equipamiento,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[]}])} style={{...sB('#7c3aed'),fontSize:11}}>+ Manual</button></div>
      <div style={{padding:10,background:'#faf5ff',borderRadius:8,border:'1px solid #e9d5ff',marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:'#7c3aed',marginBottom:6}}>📥 Master Medicación</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{xlConsNegs.map(neg=>xlConsTipos.map(tipo=>{const cnt=XL_CONS.filter(c=>c.n===neg&&c.t===tipo).length;if(!cnt)return null;return(<button key={neg+tipo} onClick={()=>loadPaq(neg,tipo)} style={{padding:'3px 8px',borderRadius:5,border:'1px solid #d8b4fe',background:'white',fontSize:10,cursor:'pointer',color:'#7c3aed'}}>{neg}–{tipo} ({cnt})</button>);}))}</div>
      </div>
      {eqT>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#f5f3ff',borderRadius:6,marginBottom:8}}><span style={{fontSize:12,fontWeight:700,color:'#7c3aed'}}>Total</span><span style={{fontSize:15,fontWeight:800,color:'#7c3aed'}}>{fmt(eqT)}/m</span></div>}
      <ImpG imps={equipImpG} setImps={setEquipImpG} total={eqT} color="#7c3aed" label="Impacto Global Equip. Consultorio"/>
      {equipamiento.length>0&&<table style={{...sT,fontSize:10,marginTop:8}}><thead><tr style={{background:'#faf5ff'}}><th style={{...sTh,fontSize:9,padding:3}}>Concepto</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'center'}}>Qty</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Amort/m</th><th style={{...sTh,fontSize:9,padding:3,textAlign:'right'}}>Total</th><th style={{...sTh,fontSize:9,padding:3}}></th></tr></thead>
      <tbody>{equipamiento.map((it,idx)=>(<tr key={it.id} style={{borderBottom:'1px solid #f3e8ff'}}>
        <td style={{padding:2}}><input value={it.concepto} onChange={e=>{const n=[...equipamiento];n[idx].concepto=e.target.value;setEquipamiento(n);}} style={{border:'none',fontSize:10,width:'100%',background:'transparent'}}/></td>
        <td style={{padding:2,textAlign:'center'}}><input type="number" value={it.qty} onChange={e=>{const n=[...equipamiento];n[idx].qty=Number(e.target.value);setEquipamiento(n);}} style={{width:30,border:'none',fontSize:10,textAlign:'center',background:'transparent'}}/></td>
        <td style={{padding:2,textAlign:'right'}}><input type="number" value={it.precioUnit} onChange={e=>{const n=[...equipamiento];n[idx].precioUnit=Number(e.target.value);setEquipamiento(n);}} style={{width:65,border:'none',fontSize:10,textAlign:'right',background:'transparent'}}/></td>
        <td style={{padding:2,textAlign:'right',fontWeight:700,color:'#7c3aed',fontSize:10}}>{fmt(cItem(it))}</td>
        <td style={{padding:2}}><button onClick={()=>setEquipamiento(equipamiento.filter(x=>x.id!==it.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:10}}>✕</button></td>
      </tr>))}</tbody></table>}
    </div>);};

  // ═══ 7️⃣ GASTOS DE ESTRUCTURA (ZREAL: prorrateo proporcional) ═══
  const xlEstrProv=useMemo(()=>XL_ESTR.filter(e=>e.pr===prov),[prov]);
  React.useEffect(()=>{setIibbAlic(IIBB_ALIC[prov]||3.5);},[prov]);
  const renderEstr=()=>{
    const ep = estructuraProrrateo;
    const mult = plazo || 1;  // adaptación al plazo (Opción A: mensual + total al plazo)
    // Cargar el desglose por categoría desde ZREAL (la vertical detectada),
    // como líneas editables (P y qty editables, se pueden eliminar).
    const loadDesglose=()=>{
      const z = GASTOS_ESTR_ZREAL?.verticales?.[verticalZreal];
      if(!z||!z.categorias){return;}
      const catsEstr = new Set(CATEGS_ESTR?.categorias_estructura||[]);
      // Si la cotización aporta pct del total, cada categoría estructural
      // se imputa proporcionalmente: cat_imputada = cat_zreal × pct.
      const items = Object.entries(z.categorias)
        .filter(([cat])=>catsEstr.has(cat))
        .map(([cat,monto])=>({
          id:uid(), concepto:cat, qty:1,
          precioUnit:Math.round((monto||0)*(ep.pct||0)),
          qTemp:'Mensual', moneda:'ARS', impactos:[],
          _zrealMonto:monto,
        }));
      setEstructura(items);
    };
    const estrT=estructura.reduce((s,it)=>s+cItem(it),0);
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>🏢</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Gastos de Estructura ({estructura.length})</h2></div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={loadDesglose} style={{...sB('#6366f1'),fontSize:10}}>📥 Desglose {verticalZreal} (prorrateado)</button>
          <button onClick={()=>setEstructura([...estructura,{id:uid(),concepto:'',qty:1,precioUnit:0,qTemp:'Mensual',moneda:'ARS',impactos:[]}])} style={{...sB('#6366f1'),fontSize:11}}>+</button>
        </div>
      </div>

      {/* Panel transparente del prorrateo */}
      <div style={{padding:14,background:'#f5f3ff',borderRadius:12,border:'1px solid #ddd6fe',marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:800,color:'#6d28d9',marginBottom:8}}>📐 Cálculo de prorrateo (ZREAL {ep.ultimoMes||'s/d'})</div>
        {!ep.ok && <div style={{padding:8,background:'#fef3c7',borderRadius:6,fontSize:11,color:'#92400e'}}>⚠ {ep.motivo}</div>}
        {ep.ok && <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:11}}>
          <div style={{color:'#4c1d95'}}>Vertical detectada (de Config):</div><div style={{fontWeight:700,textAlign:'right'}}>{ep.vertical}</div>
          <div style={{color:'#4c1d95'}}>Costo cotización (sin estructura):</div><div style={{fontWeight:700,textAlign:'right'}}>{fmt(ep.numerador)}/m</div>
          <div style={{color:'#4c1d95'}}>Gasto total vertical (ZREAL):</div><div style={{fontWeight:700,textAlign:'right'}}>{fmt(ep.denominador)}/m</div>
          <div style={{color:'#4c1d95'}}>% que pesa esta cotización:</div><div style={{fontWeight:800,textAlign:'right',color:'#6d28d9'}}>{(ep.pct*100).toFixed(2)}%</div>
          <div style={{color:'#4c1d95'}}>Gasto estructura vertical (ZREAL):</div><div style={{fontWeight:700,textAlign:'right'}}>{fmt(ep.gastoEstrVertical)}/m</div>
          <div style={{gridColumn:'1/3',borderTop:'1px solid #ddd6fe',margin:'4px 0'}}></div>
          <div style={{color:'#4c1d95',fontWeight:700}}>Gasto imputado:</div><div style={{fontWeight:800,textAlign:'right',color:'#6d28d9'}}>{fmt(ep.imputadoMensual)}/m</div>
          <div style={{color:'#4c1d95'}}>Gasto imputado al plazo ({mult}m):</div><div style={{fontWeight:800,textAlign:'right',color:'#6d28d9'}}>{fmt(ep.imputadoMensual*mult)}</div>
        </div>}
        <div style={{marginTop:8,fontSize:9,color:'#7c3aed',fontStyle:'italic'}}>Fórmula: % = costo_cotización ÷ gasto_total_vertical · imputado = % × gasto_estructura_vertical</div>
      </div>

      {estrT>0&&<div style={{display:'flex',justifyContent:'space-between',padding:8,background:'#eef2ff',borderRadius:6,marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:700,color:'#6366f1'}}>Total detallado (editable)</span>
        <span style={{fontSize:15,fontWeight:800,color:'#6366f1'}}>{fmt(estrT)}/m · {fmt(estrT*mult)} ({mult}m)</span>
      </div>}
      <ImpG imps={estrImpG} setImps={setEstrImpG} total={estrT} color="#6366f1" label="Impacto Global Estructura"/>
      {/* Tabla editable: P (precioUnit) y qty editables, eliminar filas */}
      <div style={{display:'flex',gap:4,padding:'2px 4px',fontSize:9,fontWeight:700,color:'#64748b'}}>
        <span style={{flex:2}}>Concepto</span><span style={{width:50}}>Qty</span><span style={{width:80}}>P. unit</span><span style={{width:55}}>Mensual</span><span style={{width:70}}>Al plazo</span><span style={{width:20}}></span>
      </div>
      {estructura.map((it,idx)=>(<div key={it.id} style={{display:'flex',gap:4,alignItems:'center',padding:4,background:'white',borderRadius:4,border:'1px solid #e2e8f0',marginBottom:2,fontSize:11}}>
        <input value={it.concepto} onChange={e=>{const n=[...estructura];n[idx].concepto=e.target.value;setEstructura(n);}} style={{...sIs,flex:2,fontSize:10}}/>
        <input type="number" value={it.qty} onChange={e=>{const n=[...estructura];n[idx].qty=Number(e.target.value);setEstructura(n);}} style={{...sIs,width:50,fontSize:10}}/>
        <input type="number" value={it.precioUnit} onChange={e=>{const n=[...estructura];n[idx].precioUnit=Number(e.target.value);setEstructura(n);}} style={{...sIs,width:80,fontSize:10}}/>
        <span style={{fontWeight:700,color:'#6366f1',width:55,fontSize:10}}>{fmt(cItem(it))}</span>
        <span style={{fontWeight:700,color:'#8b5cf6',width:70,fontSize:10}}>{fmt(cItem(it)*mult)}</span>
        <button onClick={()=>setEstructura(estructura.filter(x=>x.id!==it.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontSize:12,width:20}}>✕</button>
      </div>))}
    </div>);};
  const renderCap=()=>{
    const puestosActivos=[...new Set(personal.map(p=>p.puesto).filter(Boolean))];
    const capsRecomendadas=[...new Set([...puestosActivos.flatMap(p=>CAPS_POR_PUESTO[p]||[]),...(CAPS_POR_NEGOCIO[negocio]||[])])];
    const autoCargar=()=>{const nuevas=capsRecomendadas.map(nombre=>{const ref=d.caps.find(c=>c.n===nombre);return ref?{id:uid(),concepto:ref.n,costoTotal:ref.ct,freq:ref.f||'Anual',dest:ref.dest||1,activa:true,impactos:lineas.length?[{lid:lineas[0].id,pct:100}]:[],moneda:'ARS'}:null;}).filter(Boolean);setCapacitaciones([...capacitaciones,...nuevas]);};
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}><div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:24}}>📚</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Capacitaciones ({capacitaciones.length})</h2></div><div style={{display:'flex',gap:8}}><button onClick={autoCargar} style={{...sB('#059669'),fontSize:12}}>🤖 Auto ({capsRecomendadas.length})</button><button onClick={()=>setCapacitaciones([...capacitaciones,{id:uid(),concepto:'',costoTotal:0,freq:'Anual',dest:1,activa:true,impactos:[],moneda:'ARS'}])} style={{...sB('#ca8a04'),fontSize:12}}>+ Manual</button></div></div>
      {capsRecomendadas.length>0&&<div style={{padding:10,background:'#fefce8',borderRadius:8,border:'1px solid #fde68a',marginBottom:12}}><div style={{fontSize:12,fontWeight:700,color:'#a16207',marginBottom:4}}>💡 Sugeridas para: {puestosActivos.join(', ')} + {negocio}</div><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{capsRecomendadas.map(c=>(<span key={c} style={{padding:'2px 10px',background:'#fef3c7',borderRadius:20,fontSize:11,fontWeight:600,color:'#92400e'}}>{c}</span>))}</div></div>}
      <SubBar items={capacitaciones.filter(c=>c.activa!==false)} calc={cap=>(cap.costoTotal||0)*(Q_T[cap.freq]||1)} color="#ca8a04" label="Sub. Capacitaciones"/>
      {capacitaciones.map((cap,idx)=>(<div key={cap.id} style={{...sCard,opacity:cap.activa===false?0.5:1}}>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <input type="checkbox" checked={cap.activa!==false} onChange={e=>{const n=[...capacitaciones];n[idx].activa=e.target.checked;setCapacitaciones(n);}}/>
          <input value={cap.concepto} onChange={e=>{const n=[...capacitaciones];n[idx].concepto=e.target.value;setCapacitaciones(n);}} style={{...sIs,flex:2}} placeholder="Nombre"/>
          <input type="number" value={cap.costoTotal} onChange={e=>{const n=[...capacitaciones];n[idx].costoTotal=Number(e.target.value);setCapacitaciones(n);}} style={{...sIs,width:100}} placeholder="C.Total"/>
          <select value={cap.freq} onChange={e=>{const n=[...capacitaciones];n[idx].freq=e.target.value;setCapacitaciones(n);}} style={{...sIs,width:90}}>{Object.keys(Q_T).map(q=><option key={q}>{q}</option>)}</select>
          <input type="number" value={cap.dest} onChange={e=>{const n=[...capacitaciones];n[idx].dest=Number(e.target.value);setCapacitaciones(n);}} style={{...sIs,width:50}} min={1} title="Destinatarios"/>
          <span style={{fontWeight:700,color:'#ca8a04',fontSize:13,minWidth:80}}>{fmt((cap.costoTotal||0)*(Q_T[cap.freq]||1))}/m</span>
          <button onClick={()=>setCapacitaciones(capacitaciones.filter(x=>x.id!==cap.id))} style={{color:'#ef4444',background:'none',border:'none',cursor:'pointer'}}>✕</button>
        </div><ImpEd imps={cap.impactos||[]} onChange={imp=>{const n=[...capacitaciones];n[idx].impactos=imp;setCapacitaciones(n);}}/>
      </div>))}
    </div>);};


  const renderRes=()=>{
    const cats=[
      {l:'Personal',items:personal,calc:p=>calcP(p).c,color:'#3b82f6',e:'👥'},
      {l:'Backup',items:personalBk,calc:p=>calcP(p).c,color:'#6366f1',e:'🔄'},
      {l:'Uniforme',items:uniforme,calc:u=>u.tm||0,color:'#8b5cf6',e:'👕'},
      {l:'Logística',items:[{v:logCalc.reduce((s,l)=>s+l.v,0)+logMovXL.reduce((s,m)=>s+(m.vm||0),0)+logExtraCost},...logistica],calc:it=>it.v||cItem(it),color:'#0891b2',e:'🚛'},
      {l:'Hospedaje',items:hospedaje,calc:cItem,color:'#0d9488',e:'🏨'},
      {l:'Capacit.',items:capacitaciones.filter(c=>c.activa!==false),calc:cap=>(cap.costoTotal||0)*(Q_T[cap.freq]||1),color:'#ca8a04',e:'📚'},
      {l:'Comunicación',items:comunicacion,calc:cItem,color:'#0891b2',e:'📡'},
      {l:'Ambulancias',items:ambulancias,calc:a=>a.cm||0,color:'#dc2626',e:'🚑'},
      {l:'EECC Móviles',items:movilesXL,calc:m=>m.vm||0,color:'#b91c1c',e:'🚗'},
      {l:'Trailers',items:trailers,calc:t=>t.cm||0,color:'#d97706',e:'🏠'},
      {l:'Medicación',items:medicamentos,calc:cMed,color:'#e11d48',e:'💊'},
      {l:'Otros',items:otrosCostos,calc:cItem,color:'#059669',e:'💰'},
      {l:'Equip. Consultorio',items:equipamiento,calc:cItem,color:'#7c3aed',e:'🔧'},
      {l:'Gastos de Estructura',items:estructura,calc:cItem,color:'#6366f1',e:'🏢'},
    ];
    const mul=resVista==='mes'?1:plazo;const lbl=resVista==='mes'?'/mes':'/contrato';
    const subtotalCostos=totales.tM*mul;
    const importeBruto=totales.tV*mul;
    const margenBruto=importeBruto-subtotalCostos;const margenPct=importeBruto>0?(margenBruto/importeBruto*100):0;
    const impIIBB=importeBruto*(iibbAlic/100);const impSello=importeBruto*(selloAlic/100);const impOtro=otroImp.alic>0?importeBruto*(otroImp.alic/100):otroImp.fijo*mul;
    const impTotal=impOn?(impIIBB+impSello+impOtro):0;
    const utilidad=importeBruto-subtotalCostos-impTotal;const utilPct=importeBruto>0?(utilidad/importeBruto*100):0;
    const fmtAR=v=>{if(monedaVis==='USD'&&dolar>0)return 'U$S '+Math.round(v/dolar).toLocaleString('es-AR');return '$'+Math.round(v).toLocaleString('es-AR');};
    // 5️⃣ Export Excel - Estructura de Costos
    const dlFile=(content,name,type)=>{const a=document.createElement('a');a.href='data:'+type+';charset=utf-8,'+encodeURIComponent(content);a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);};
    const exportXLS=()=>{let csv='\uFEFF"ESTRUCTURA DE COSTOS - Sistema Cotizador Op. Complejas"\n"'+( nomCot||'Cotización')+'"\n"Cliente:","'+(cliente||'—')+'","Provincia:","'+prov+'","Negocio:","'+negocio+'","Plazo:",'+plazo+'\n\n';
      csv+='"Categoría","Concepto","Qty","Costo Unit.","Total Mensual","Impacto"\n';
      cats.forEach(ct=>{const catT=ct.items.reduce((s,it)=>s+ct.calc(it),0);if(catT<=0)return;csv+='"'+ct.l+'","","","","'+catT.toFixed(0)+'",""\n';ct.items.forEach(it=>{const c=ct.calc(it);if(c<=0)return;const nom=it.concepto||it.nombre||it.puesto||it.mod||it.desc||'—';const q=it.qty||it.dotacion||1;csv+='","'+nom+'",'+q+','+(c/Math.max(q,1)).toFixed(0)+','+c.toFixed(0)+',"'+(it.impactos?.map(im=>lineas.find(l2=>l2.id===im.lid)?.nombre+':'+im.pct+'%').join('; ')||'—')+'"\n';});});
      csv+='\n"RESUMEN"\n"Subtotal Costos",'+subtotalCostos.toFixed(0)+'\n"Importe Bruto Venta",'+importeBruto.toFixed(0)+'\n"Margen Bruto",'+margenBruto.toFixed(0)+',"'+margenPct.toFixed(1)+'%"\n';
      if(impOn)csv+='"IIBB '+iibbAlic+'%",'+impIIBB.toFixed(0)+'\n"Sello '+selloAlic+'%",'+impSello.toFixed(0)+'\n"'+(otroImp.nombre||'Otro')+' '+otroImp.alic+'%",'+impOtro.toFixed(0)+'\n"Total Impuestos",'+impTotal.toFixed(0)+'\n';
      csv+='"Utilidad",'+utilidad.toFixed(0)+',"'+utilPct.toFixed(1)+'%"\n';
      csv+='\n"DETALLE POR LÍNEA"\n"Línea","Costo","MU%","Venta","Q Contrato"\n';
      lineas.forEach(l=>{const c=totales.pL[l.id]?.c||0;csv+='"'+l.nombre+'",'+c.toFixed(0)+','+l.mu+','+(c*(1+l.mu/100)).toFixed(0)+','+(c*(1+l.mu/100)*plazo).toFixed(0)+'\n';});
      dlFile(csv,'estructura_costos_'+(nomCot||'exp')+'.csv','text/csv');};
    const exportPDFCliente=()=>{const rows=lineas.map(l=>{const v=(totales.pL[l.id]?.c||0)*(1+l.mu/100);return{n:l.nombre,vm:v,vc:v*plazo};});const vtm=rows.reduce((s,r)=>s+r.vm,0);const vtc=rows.reduce((s,r)=>s+r.vc,0);
      const html='<html><head><title>Propuesta - '+(nomCot||'Cotización')+'</title><style>@page{size:A4;margin:30mm 20mm}body{font-family:Helvetica,Arial,sans-serif;margin:0;padding:40px;color:#1e293b}.hdr{text-align:center;margin-bottom:40px;border-bottom:3px solid #4f46e5;padding-bottom:20px}.hdr h1{font-size:24px;color:#4f46e5;margin:0 0 8px}.hdr p{font-size:13px;color:#64748b;margin:4px 0}table{width:100%;border-collapse:collapse;margin:24px 0}th{background:#4f46e5;color:white;padding:12px 16px;text-align:left;font-size:12px}td{padding:10px 16px;border-bottom:1px solid #e2e8f0;font-size:13px}.r{text-align:right;font-weight:600}.tf{background:#f1f5f9;font-weight:700;font-size:14px}.ft{margin-top:40px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:16px}</style></head><body><div class="hdr"><h1>'+(nomCot||'Propuesta Comercial - Op. Complejas')+'</h1><p>Cliente: <strong>'+(cliente||'—')+'</strong></p><p>'+prov+' | '+negocio+' | Plazo: '+plazo+' meses</p></div><table><thead><tr><th>Servicio</th><th style="text-align:right">Valor Mensual</th><th style="text-align:right">Valor Contrato</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+r.n+'</td><td class="r">'+fmtAR(r.vm)+'</td><td class="r">'+fmtAR(r.vc)+'</td></tr>').join('')+'<tr class="tf"><td>TOTAL</td><td class="r">'+fmtAR(vtm)+'</td><td class="r">'+fmtAR(vtc)+'</td></tr></tbody></table>'+(impOn?'<p style="font-size:12px;color:#64748b">* Impuestos: IIBB '+iibbAlic+'%, Sello '+selloAlic+'%</p>':'')+'<div class="ft"><p>Propuesta válida por 30 días</p></div></body></html>';
      dlFile(html,'propuesta_'+(nomCot||'cliente')+'.html','text/html');};
    const rB={display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderRadius:8,marginBottom:6};
    return(<div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}><div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:24}}>📊</span><h2 style={{fontSize:20,fontWeight:700,color:'#1e293b'}}>Resumen</h2></div><div style={{display:'flex',gap:5,alignItems:'center'}}>
        <div style={{display:'flex',borderRadius:6,overflow:'hidden',border:'1px solid #d1d5db'}}><button onClick={()=>setResVista('mes')} style={{padding:'4px 10px',fontSize:10,fontWeight:resVista==='mes'?700:400,background:resVista==='mes'?'#4f46e5':'white',color:resVista==='mes'?'white':'#374151',border:'none',cursor:'pointer'}}>Mensual</button><button onClick={()=>setResVista('contrato')} style={{padding:'4px 10px',fontSize:10,fontWeight:resVista==='contrato'?700:400,background:resVista==='contrato'?'#4f46e5':'white',color:resVista==='contrato'?'white':'#374151',border:'none',cursor:'pointer'}}>Contrato ({plazo}m)</button></div>
        <button onClick={exportXLS} style={{...sB('#059669'),fontSize:10}}>📥 Excel Costos</button><button onClick={exportPDFCliente} style={{...sB('#4f46e5'),fontSize:10}}>🖨 PDF Cliente</button></div></div>
      <table style={sT}><thead><tr style={{background:'#1e293b'}}><th style={{...sTh,color:'white'}}>Línea</th><th style={{...sTh,color:'white',textAlign:'right'}}>Costo</th><th style={{...sTh,color:'white',textAlign:'center',width:55}}>MU%</th><th style={{...sTh,color:'white',textAlign:'right'}}>Venta</th><th style={{...sTh,color:'white',width:22}}></th></tr></thead>
      <tbody>{lineas.map((l,i)=>{const c=(totales.pL[l.id]?.c||0)*mul;const v=c*(1+l.mu/100);const isE=resExp[l.id];return(<React.Fragment key={l.id}><tr style={{borderBottom:'1px solid #e2e8f0',background:i%2===0?'#f8fafc':'white',cursor:'pointer'}} onClick={()=>setResExp(p=>({...p,[l.id]:!p[l.id]}))}><td style={sTd}><span style={{fontWeight:600}}>{l.nombre}</span></td><td style={{...sTd,textAlign:'right',fontWeight:600}}>{fmt(c)}</td><td style={{...sTd,textAlign:'center',fontSize:12}}>{l.mu}%</td><td style={{...sTd,textAlign:'right',fontWeight:700,color:'#059669'}}>{fmt(v)}</td><td style={{...sTd,textAlign:'center',color:'#94a3b8',fontSize:10}}>{isE?'▲':'▼'}</td></tr>{isE&&<tr><td colSpan={5} style={{padding:'6px 14px',background:'#fafafa'}}><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:5}}>{cats.filter(ct=>ct.items.length>0).map(ct=>{const tot=ct.items.reduce((s,it)=>s+ct.calc(it),0)*mul;return tot>0?<div key={ct.l} style={{padding:5,borderRadius:4,background:'white',border:'1px solid #e2e8f0',borderLeft:`3px solid ${ct.color}`}}><div style={{fontSize:9,color:'#6b7280'}}>{ct.e} {ct.l}</div><div style={{fontSize:12,fontWeight:700,color:ct.color}}>{fmt(tot)}</div></div>:null;})}</div></td></tr>}</React.Fragment>);})}</tbody></table>
      <div style={{marginTop:16}}>
        <div style={{...rB,background:'#f1f5f9',border:'1px solid #e2e8f0'}}><div><span style={{fontSize:13,fontWeight:700,color:'#475569'}}>① Subtotal de Costos</span><span style={{fontSize:10,color:'#94a3b8',marginLeft:8}}>Sin MU% ni impuestos</span></div><span style={{fontSize:20,fontWeight:800,color:'#475569'}}>{fmt(subtotalCostos)}</span></div>
        <div style={{...rB,background:'#ecfdf5',border:'1px solid #a7f3d0'}}><div><span style={{fontSize:13,fontWeight:700,color:'#059669'}}>② Importe Bruto de Venta</span><span style={{fontSize:10,color:'#6b7280',marginLeft:8}}>Costos + MU%</span></div><span style={{fontSize:20,fontWeight:800,color:'#059669'}}>{fmt(importeBruto)}</span></div>
        <div style={{...rB,background:'#eff6ff',border:'1px solid #bfdbfe'}}><div><span style={{fontSize:13,fontWeight:700,color:'#2563eb'}}>③ Margen Bruto</span><span style={{fontSize:10,color:'#6b7280',marginLeft:8}}>Venta − Costos</span></div><div style={{textAlign:'right'}}><span style={{fontSize:20,fontWeight:800,color:'#2563eb'}}>{fmt(margenBruto)}</span><span style={{fontSize:12,fontWeight:700,color:'#60a5fa',marginLeft:8}}>{margenPct.toFixed(1)}%</span></div></div>
        <div style={{...rB,background:impOn?'#fef2f2':'#f9fafb',border:'1px solid '+(impOn?'#fecaca':'#e5e7eb')}}><div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:13,fontWeight:700,color:impOn?'#dc2626':'#9ca3af'}}>④ Impuestos</span><label style={{fontSize:11,display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" checked={impOn} onChange={e=>setImpOn(e.target.checked)}/> Aplicar</label></div>
          {impOn&&<div style={{display:'flex',gap:12,marginTop:6,fontSize:11}}>
            <span style={{color:'#dc2626'}}>IIBB <b>{iibbAlic}%</b> = {fmt(impIIBB)}</span><span style={{color:'#6b7280'}}>|</span>
            <span style={{color:'#d97706'}}>Sello <b>{selloAlic}%</b> = {fmt(impSello)}</span><span style={{color:'#6b7280'}}>|</span>
            <span style={{color:'#0369a1'}}>{otroImp.nombre||'Otro'} <b>{otroImp.alic>0?otroImp.alic+'%':'$'+fmt(otroImp.fijo)}</b> = {fmt(impOtro)}</span>
          </div>}
        </div><span style={{fontSize:18,fontWeight:800,color:impOn?'#dc2626':'#d1d5db'}}>{impOn?'-'+fmt(impTotal):'—'}</span></div>
        <div style={{...rB,background:'linear-gradient(135deg,#4f46e5,#7c3aed)',border:'none'}}><div><span style={{fontSize:14,fontWeight:800,color:'white'}}>⑤ Utilidad Final</span><span style={{fontSize:10,color:'rgba(255,255,255,0.7)',marginLeft:8}}>Venta − Costos − Impuestos</span></div><div style={{textAlign:'right'}}><span style={{fontSize:22,fontWeight:800,color:'white'}}>{fmt(utilidad)}</span><span style={{fontSize:13,fontWeight:700,color:'rgba(255,255,255,0.8)',marginLeft:8}}>{utilPct.toFixed(1)}%</span></div></div>
      </div>
      <div style={{marginTop:14}}><div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📋 Subtotales por categoría</div><div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6}}>{cats.filter(ct=>ct.items.length>0).map(ct=>{const tot=ct.items.reduce((s,it)=>s+ct.calc(it),0)*mul;return(<div key={ct.l} style={{padding:8,borderRadius:6,background:'white',border:'1px solid #e2e8f0',borderLeft:`3px solid ${ct.color}`}}><span style={{fontSize:10,fontWeight:600}}>{ct.e} {ct.l}</span><div style={{fontSize:14,fontWeight:800,color:ct.color,marginTop:2}}>{fmt(tot)}</div></div>);})}</div></div>
    </div>);};

  const menu=[
    {id:'config',l:'Config',e:'⚙️'},{id:'cotizacion',l:'Cotización',e:'📋'},
    {id:'resumen',l:'Resumen',e:'📊'},
    {id:'personal',l:'Personal',e:'👥',c:personal.length},{id:'backup',l:'Backup',e:'🔄',c:personalBk.length},
    {id:'uniforme',l:'Uniforme',e:'👕',c:uniforme.length},
    {id:'logistica',l:'Logística',e:'🚛'},
    {id:'hospedaje',l:'Hospedaje',e:'🏨',c:hospedaje.length},
    {id:'capacitaciones',l:'Capacitaciones',e:'📚',c:capacitaciones.length},
    {id:'comunicacion',l:'Comunicación',e:'📡',c:comunicacion.length},
    {id:'ambulancias',l:'Ambulancias',e:'🚑',c:ambulancias.length},
    {id:'trailers',l:'Trailers',e:'🏠',c:trailers.length},
    {id:'medicamentos',l:'Medicación',e:'💊',c:medicamentos.length},
    {id:'otrosCostos',l:'Otros Costos',e:'💰',c:otrosCostos.length},
    {id:'equipamiento',l:'Equip. Consultorio',e:'🔧',c:equipamiento.length},
    {id:'estructura',l:'Gastos de Estructura',e:'🏢',c:estructura.length},
  ];

  return(
    <div style={{minHeight:'100vh',background:'#f8fafc'}}>
      <RedistModal/>
      <header style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)',color:'white',padding:'12px 20px',position:'sticky',top:0,zIndex:40,boxShadow:'0 4px 15px rgba(0,0,0,0.15)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{fontSize:22}}>🏥</span><div><h1 style={{fontSize:18,fontWeight:800}}>Sistema Cotizador Op. Complejas</h1><p style={{fontSize:11,opacity:0.8}}>{negocio} • {prov} • {mesCot}</p></div></div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{display:'flex',borderRadius:6,overflow:'hidden',border:'1px solid rgba(255,255,255,0.3)'}}>{['ARS','USD'].map(m=>(<button key={m} onClick={()=>{if(m==='USD'&&(!dolar||dolar<=0)){alert('Tipo de cambio inválido. Configure el dólar en Configuración.');return;}setMonedaVis(m);}} style={{padding:'3px 10px',fontSize:10,fontWeight:monedaVis===m?800:400,background:monedaVis===m?'rgba(255,255,255,0.25)':'transparent',color:'white',border:'none',cursor:'pointer'}}>{m==='ARS'?'$ ARS':'U$S USD'}</button>))}</div>
            <div style={{textAlign:'right'}}><p style={{fontSize:20,fontWeight:800}}>{fmt(totales.tV)}<span style={{fontSize:12,opacity:0.7}}>/mes</span></p><p style={{fontSize:12,opacity:0.7}}>Q: {fmt(totales.tC)}</p></div>
          </div>
        </div>
      </header>
      <div style={{display:'flex',minHeight:'calc(100vh - 80px)'}}>
        <nav style={{width:200,background:'white',borderRight:'1px solid #e2e8f0',position:'sticky',top:56,height:'calc(100vh - 56px)',overflowY:'auto',flexShrink:0}}>
          {menu.map(m=>(<button key={m.id} onClick={()=>setSec(m.id)} style={{width:'100%',padding:'10px 14px',textAlign:'left',border:'none',background:sec===m.id?'#eef2ff':'transparent',borderLeft:sec===m.id?'3px solid #4f46e5':'3px solid transparent',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:sec===m.id?700:500,color:sec===m.id?'#4338ca':'#374151'}}><span>{m.e}</span><span style={{flex:1}}>{m.l}</span>{m.c>0&&<span style={{background:'#e0e7ff',color:'#4338ca',padding:'1px 6px',borderRadius:10,fontSize:11,fontWeight:700}}>{m.c}</span>}</button>))}
        </nav>
        <main style={{flex:1,padding:24,maxWidth:1100}}>
          {sec==='config'&&renderConfig()}
          {sec==='cotizacion'&&renderCot()}
          {sec==='resumen'&&renderRes()}
          {sec==='personal'&&renderPersonal()}
          {sec==='backup'&&renderBk()}
          {sec==='uniforme'&&renderUni()}
          {sec==='logistica'&&renderLog()}
          {sec==='hospedaje'&&renderCat({titulo:'Hospedaje',emoji:'🏨',items:hospedaje,setItems:setHospedaje,defs:[{c:'Hospedaje',cm:0}],color:'#0d9488'})}
          {sec==='capacitaciones'&&renderCap()}
          {sec==='comunicacion'&&renderCom()}
          {sec==='ambulancias'&&renderAmb()}
          {sec==='trailers'&&renderTr()}
          {sec==='medicamentos'&&renderMed()}
          {sec==='otrosCostos'&&renderOtros()}
          {sec==='equipamiento'&&renderEquip()}
          {sec==='estructura'&&renderEstr()}
        </main>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 BOOTSTRAP — carga remota antes de montar el cotizador
// ═══════════════════════════════════════════════════════════════════════════
// Wrapper que respeta la interfaz actual del export default. Muestra un
// spinner mientras hidrata; el indicador de estado queda SIEMPRE visible
// arriba del cotizador para que el usuario sepa qué datos está usando.
const SistemaCotizadorConRemoteData = () => {
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState(null);

  useEffect(() => {
    let alive = true;
    // loadRemoteData NUNCA rechaza ni cuelga (tiene hard-stop interno),
    // así que el .then() siempre se ejecuta. El .catch() está por defensa
    // en profundidad pero en la práctica nunca debería dispararse.
    loadRemoteData()
      .then((r) => { if (alive) { setReport(r); setReady(true); } })
      .catch((e) => {
        if (alive) {
          setReport({ ok: [], fail: [{ varName: 'all', error: e.message }], invalid: [], source: 'error' });
          setReady(true);
        }
      });
    return () => { alive = false; };
  }, []);

  // Spinner mientras carga (con un mensaje de fallback si tarda mucho)
  if (!ready) {
    return (
      <div style={{minHeight:'100vh',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12}}>
        <div style={{fontSize:32}}>⏳</div>
        <div style={{fontSize:14,fontWeight:600,color:'#4f46e5'}}>Cargando datos maestros…</div>
        <div style={{fontSize:11,color:'#6b7280'}}>{WORKER_CONFIG.baseUrl}</div>
        <div style={{fontSize:10,color:'#9ca3af',marginTop:8}}>Si esto tarda más de unos segundos, el cotizador igual va a abrirse con datos locales.</div>
      </div>
    );
  }

  return (
    <>
      <DataStatusBar report={report} />
      <SistemaCotizadorOpComplejas />
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Indicador de estado de datos — SIEMPRE visible arriba del cotizador.
// 4 estados: cargando (manejado en el wrapper), remote OK, cache, error/local.
// ─────────────────────────────────────────────────────────────────────────
const DataStatusBar = ({ report }) => {
  if (!report) return null;

  const totalFiles = Object.keys(REMOTE_FILES).length;
  const okCount = report.ok?.length || 0;
  const failCount = report.fail?.length || 0;
  const invalidCount = report.invalid?.length || 0;
  const fallbackCount = failCount + invalidCount;

  // Decidir estado visual según source + cuántos archivos fallaron
  let icon, label, bg, fg, border;
  if (report.source === 'remote' && fallbackCount === 0) {
    icon = '✅'; label = 'Datos cargados desde GitHub';
    bg = '#ecfdf5'; fg = '#065f46'; border = '#6ee7b7';
  } else if (report.source === 'cache') {
    icon = '⚠️'; label = 'Usando datos cacheados';
    bg = '#fef3c7'; fg = '#92400e'; border = '#fcd34d';
  } else if (report.source === 'remote' && fallbackCount > 0) {
    icon = '⚠️'; label = `Carga parcial: ${okCount}/${totalFiles} desde GitHub, ${fallbackCount} con fallback local`;
    bg = '#fef3c7'; fg = '#92400e'; border = '#fcd34d';
  } else if (report.source === 'local-disabled') {
    icon = 'ℹ️'; label = 'Modo solo local (Worker deshabilitado)';
    bg = '#dbeafe'; fg = '#1e40af'; border = '#93c5fd';
  } else {
    // 'error' o 'timeout'
    icon = '❌'; label = 'Error al cargar datos remotos · usando fallback local';
    bg = '#fee2e2'; fg = '#991b1b'; border = '#fca5a5';
  }

  const handleReload = () => {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    window.location.reload();
  };

  return (
    <div style={{
      padding:'8px 16px',
      background:bg,
      color:fg,
      fontSize:12,
      fontWeight:600,
      borderBottom:`1px solid ${border}`,
      display:'flex',
      justifyContent:'space-between',
      alignItems:'center',
      gap:12,
      flexWrap:'wrap',
    }}>
      <span style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:14}}>{icon}</span>
        <span>{label}</span>
        <span style={{
          fontSize:10,
          padding:'2px 8px',
          borderRadius:10,
          background:`${fg}15`,
          color:fg,
          fontWeight:700,
        }}>
          {report.source} · {okCount} OK · {fallbackCount} fallback
        </span>
      </span>
      <button
        onClick={handleReload}
        title="Forzar recarga ignorando cache"
        style={{
          fontSize:11,
          background:'transparent',
          border:`1px solid ${fg}`,
          color:fg,
          padding:'3px 10px',
          borderRadius:4,
          cursor:'pointer',
          fontWeight:700,
          whiteSpace:'nowrap',
        }}
      >↻ Recargar datos</button>
    </div>
  );
};

export default SistemaCotizadorConRemoteData;
