/**
 * InnoSoft Days 2026 · Sincronización Escaleta → Google Calendar
 *
 * Copia cada actividad de la hoja "Escaleta" a un calendario de Google compartido.
 * La hoja manda: si cambias algo en la Escaleta, el calendario se actualiza;
 * si borras o cancelas una fila, el evento desaparece del calendario.
 *
 * Instalación: Extensiones > Apps Script, pega este archivo, guarda y ejecuta
 * "configurarTodo" una vez (pedirá permisos). Después tendrás el menú "InnoSoft".
 */

// ------------------------------------------------------------------ Ajustes
const AJUSTES = {
  nombreCalendario: 'InnoSoft Days 2026',
  hoja: 'Escaleta',
  primeraFila: 5,              // primera fila de datos (la 4 es la cabecera)
  minutosEntreSincronizaciones: 15,
  // Estados que se pasan al calendario. "Cancelada" nunca se sincroniza.
  estadosSincronizados: ['Borrador', 'Pendiente de visto bueno', 'Confirmada'],
  // Prefijo en el título para lo que aún no está confirmado
  prefijoPorEstado: {
    'Borrador': '[Borrador] ',
    'Pendiente de visto bueno': '[Pendiente] ',
    'Confirmada': ''
  },
  // Colores de Google Calendar por comité (los más próximos a los de la hoja)
  colorPorComite: {           // IDs de color de Google Calendar
    'Dirección / Presidencia': '9',    // Arándano
    'Secretaría General': '8',         // Grafito
    'Programa': '1',                   // Lavanda
    'Logística': '5',                  // Plátano
    'Comunicación': '7',               // Pavo real
    'Finanzas': '10',                  // Albahaca
    'Igualdad y Sostenibilidad': '3'   // Uva
  }
};

// Columnas de la Escaleta (1 = A)
const COL = {
  dia: 1, horaFija: 2, inicio: 3, duracion: 4, fin: 5, actividad: 6, tipo: 7,
  sala: 8, comite: 9, responsable: 10, estado: 11, notas: 12, aviso: 13,
  idEvento: 14               // columna N: la rellena el script, no tocar
};
const ETIQUETA = 'innosoft-escaleta';

// ------------------------------------------------------------------ Menú
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('InnoSoft')
    .addItem('Sincronizar con Google Calendar ahora', 'sincronizar')
    .addSeparator()
    .addItem('Configurar (calendario y sincronización automática)', 'configurarTodo')
    .addItem('Ver enlace del calendario', 'mostrarCalendario')
    .addToUi();
}

// ------------------------------------------------------------------ Configuración inicial
function configurarTodo() {
  const cal = obtenerCalendario_(true);
  prepararColumnaId_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar')
    .timeBased().everyMinutes(AJUSTES.minutosEntreSincronizaciones).create();
  const resumen = sincronizar();
  aviso_('Listo. Calendario "' + cal.getName() + '" conectado.\n\n' + resumen +
    '\n\nSe sincroniza solo cada ' + AJUSTES.minutosEntreSincronizaciones +
    ' minutos, y cuando quieras desde el menú InnoSoft.\n\nID del calendario (para compartirlo):\n' + cal.getId());
}

function mostrarCalendario() {
  const cal = obtenerCalendario_(false);
  if (!cal) return aviso_('Todavía no hay calendario. Ejecuta InnoSoft > Configurar.');
  aviso_('Calendario: ' + cal.getName() + '\nID: ' + cal.getId() +
    '\n\nCompártelo desde Google Calendar > Configuración del calendario > ' +
    'Compartir con determinadas personas, con permiso "Ver todos los detalles del evento".');
}

// ------------------------------------------------------------------ Sincronización
function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return 'Otra sincronización en curso, se omite.';
  try {
    const cal = obtenerCalendario_(true);
    const hoja = SpreadsheetApp.getActive().getSheetByName(AJUSTES.hoja);
    prepararColumnaId_();
    const ultima = hoja.getLastRow();
    if (ultima < AJUSTES.primeraFila) return 'La Escaleta está vacía.';

    const n = ultima - AJUSTES.primeraFila + 1;
    const rango = hoja.getRange(AJUSTES.primeraFila, 1, n, COL.idEvento);
    const valores = rango.getValues();
    const textos = rango.getDisplayValues();   // horas como "09:30", sin desfases de zona horaria
    const ids = valores.map(f => [f[COL.idEvento - 1]]);
    const enUso = new Set();
    const url = SpreadsheetApp.getActive().getUrl();
    let creados = 0, actualizados = 0, borrados = 0, omitidos = 0;

    valores.forEach((fila, i) => {
      const d = leerFila_(fila, textos[i]);
      let id = String(fila[COL.idEvento - 1] || '');
      let evento = id ? buscarEvento_(cal, id) : null;

      if (!d) {                              // fila vacía, incompleta o cancelada
        if (evento) { evento.deleteEvent(); borrados++; }
        if (id) ids[i][0] = '';
        if (fila[COL.actividad - 1]) omitidos++;
        return;
      }

      const titulo = (AJUSTES.prefijoPorEstado[d.estado] || '') + d.actividad;
      const descripcion = [
        'Comité: ' + d.comite,
        'Responsable: ' + d.responsable,
        'Tipo: ' + d.tipo,
        'Estado: ' + d.estado,
        d.notas ? '\nNotas: ' + d.notas : '',
        '\nEscaleta: ' + url
      ].filter(Boolean).join('\n');

      if (!evento) {
        evento = cal.createEvent(titulo, d.inicio, d.fin, { location: d.sala, description: descripcion });
        evento.setTag(ETIQUETA, '1');
        creados++;
      } else {
        let cambio = false;
        if (evento.getTitle() !== titulo) { evento.setTitle(titulo); cambio = true; }
        if (evento.getStartTime().getTime() !== d.inicio.getTime() ||
            evento.getEndTime().getTime() !== d.fin.getTime()) { evento.setTime(d.inicio, d.fin); cambio = true; }
        if (evento.getLocation() !== d.sala) { evento.setLocation(d.sala); cambio = true; }
        if (evento.getDescription() !== descripcion) { evento.setDescription(descripcion); cambio = true; }
        if (cambio) actualizados++;
      }
      const color = AJUSTES.colorPorComite[d.comite];
      if (color && evento.getColor() !== color) evento.setColor(color);

      ids[i][0] = evento.getId();
      enUso.add(evento.getId());
    });

    hoja.getRange(AJUSTES.primeraFila, COL.idEvento, n, 1).setValues(ids);

    // Eventos creados por el script cuya fila ya no existe (fila borrada)
    const desde = new Date(); desde.setFullYear(desde.getFullYear() - 1);
    const hasta = new Date(); hasta.setFullYear(hasta.getFullYear() + 2);
    cal.getEvents(desde, hasta).forEach(ev => {
      if (ev.getTag(ETIQUETA) && !enUso.has(ev.getId())) { ev.deleteEvent(); borrados++; }
    });

    return 'Creados: ' + creados + ' · Actualizados: ' + actualizados +
      ' · Borrados: ' + borrados + (omitidos ? ' · Sin sincronizar (incompletas o canceladas): ' + omitidos : '');
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------ Utilidades
function leerFila_(fila, texto) {
  const dia = fila[COL.dia - 1];
  const actividad = String(fila[COL.actividad - 1] || '').trim();
  const estado = String(fila[COL.estado - 1] || 'Borrador').trim() || 'Borrador';
  const hIni = texto[COL.inicio - 1], hFin = texto[COL.fin - 1];
  if (!(dia instanceof Date) || !actividad || !hIni || !hFin) return null;
  if (AJUSTES.estadosSincronizados.indexOf(estado) === -1) return null;
  const inicio = conHora_(dia, hIni), fin = conHora_(dia, hFin);
  if (!inicio || !fin || fin <= inicio) return null;
  return {
    inicio, fin, actividad, estado,
    tipo: String(fila[COL.tipo - 1] || ''),
    sala: String(fila[COL.sala - 1] || ''),
    comite: String(fila[COL.comite - 1] || ''),
    responsable: String(fila[COL.responsable - 1] || ''),
    notas: String(fila[COL.notas - 1] || '')
  };
}

function conHora_(dia, hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Number(m[1]), Number(m[2]));
}

function buscarEvento_(cal, id) {
  try { return cal.getEventById(id); } catch (e) { return null; }
}

function obtenerCalendario_(crearSiFalta) {
  const props = PropertiesService.getDocumentProperties();
  const id = props.getProperty('CALENDAR_ID');
  let cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal && crearSiFalta) {
    cal = CalendarApp.createCalendar(AJUSTES.nombreCalendario, {
      summary: 'Escaleta compartida de InnoSoft Days. Se genera desde la hoja; no edites aquí los eventos.',
      timeZone: 'Europe/Madrid',
      color: CalendarApp.Color.BLUE
    });
    props.setProperty('CALENDAR_ID', cal.getId());
  }
  return cal;
}

function prepararColumnaId_() {
  const hoja = SpreadsheetApp.getActive().getSheetByName(AJUSTES.hoja);
  const cab = hoja.getRange(AJUSTES.primeraFila - 1, COL.idEvento);
  if (cab.getValue() !== 'ID evento (no tocar)') {
    cab.setValue('ID evento (no tocar)')
      .setFontColor('#FFFFFF').setBackground('#5E6675').setFontWeight('bold')
      .setFontFamily('Arial').setFontSize(9).setWrap(true).setVerticalAlignment('middle');
    hoja.getRange(AJUSTES.primeraFila, COL.idEvento, hoja.getMaxRows() - AJUSTES.primeraFila + 1, 1)
      .setFontColor('#9AA1AD').setFontSize(8).setBackground('#F4F6FA');
    hoja.setColumnWidth(COL.idEvento, 120);
  }
}

function aviso_(texto) {
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) { console.log(texto); }
}
