/**
 * Datos mock para el modo invitado.
 *
 * Alumno ficticio:  "Invitado", Legajo 12345
 * Carrera:          Ingeniería en Sistemas de Información (ISI), Plan 2008
 * Año:              4to año, activo
 * Materias aprobadas: 27 / 40 · Promedio: ~7.81
 */

import type {
  SysacadCursado,
  SysacadAvance,
  SysacadExamenes,
  SysacadPlan,
} from "@/lib/sysacadws";
import type { MoodleConversation } from "@/lib/chat";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unixNow() { return Math.floor(Date.now() / 1000); }
function unixDaysAgo(n: number) { return unixNow() - n * 86400; }
function unixOf(iso: string) { return Math.floor(new Date(iso + "T00:00:00").getTime() / 1000); }

// ─── CAMPUS (Moodle) ──────────────────────────────────────────────────────────

export const MOCK_COURSES = [
  {
    id: 1001,
    fullname: "Sistemas de Información — ISI 4K (2026)",
    shortname: "SI-4K-26",
    summary: "<p>Modelos de datos, análisis de sistemas y diseño estructurado.</p>",
    summaryformat: 1,
    startdate: unixOf("2026-03-02"),
    enddate:   unixOf("2026-07-04"),
    visible: 1,
    progress: 45,
    completed: false,
    isfavourite: false,
    hidden: false,
    timeaccess: unixDaysAgo(1),
    coursecategory: "ISI — 4to Año",
  },
  {
    id: 1002,
    fullname: "Gestión de Proyectos — ISI 4K (2026)",
    shortname: "GP-4K-26",
    summary: "<p>Metodologías ágiles, planificación y control de proyectos de software.</p>",
    summaryformat: 1,
    startdate: unixOf("2026-03-02"),
    enddate:   unixOf("2026-07-04"),
    visible: 1,
    progress: 60,
    completed: false,
    isfavourite: false,
    hidden: false,
    timeaccess: unixDaysAgo(2),
    coursecategory: "ISI — 4to Año",
  },
  {
    id: 1003,
    fullname: "Seguridad Informática — ISI 4K (2026)",
    shortname: "SInfo-4K-26",
    summary: "<p>Criptografía, protección de sistemas y análisis de vulnerabilidades.</p>",
    summaryformat: 1,
    startdate: unixOf("2026-03-02"),
    enddate:   unixOf("2026-07-04"),
    visible: 1,
    progress: 30,
    completed: false,
    isfavourite: false,
    hidden: false,
    timeaccess: unixDaysAgo(3),
    coursecategory: "ISI — 4to Año",
  },
  {
    id: 1004,
    fullname: "Diseño de Sistemas — ISI 4K (2025)",
    shortname: "DS-4K-25",
    summary: "<p>UML, patrones de diseño y arquitectura de software.</p>",
    summaryformat: 1,
    startdate: unixOf("2025-03-03"),
    enddate:   unixOf("2025-07-05"),
    visible: 1,
    progress: 100,
    completed: true,
    isfavourite: false,
    hidden: false,
    timeaccess: unixDaysAgo(180),
    coursecategory: "ISI — 4to Año",
  },
];

// ─── Course sections (per course) ─────────────────────────────────────────────

type MockSection = { id: number; name: string; summary: string; modules: MockModule[] };
type MockModule  = { id: number; name: string; modname: string; url?: string; contents?: unknown[] };

export const MOCK_COURSE_SECTIONS: Record<number, { courseName: string; data: MockSection[] }> = {
  1001: {
    courseName: "Sistemas de Información — ISI 4K (2026)",
    data: [
      {
        id: 1, name: "Inicio", summary: "",
        modules: [
          { id: 10011, name: "Novedades y avisos del curso", modname: "forum", url: "https://frsfco.cvg.utn.edu.ar/mod/forum/view.php?id=10011" },
          { id: 10012, name: "Programa analítico 2026 (PDF)", modname: "resource", url: "https://frsfco.cvg.utn.edu.ar/mod/resource/view.php?id=10012",
            contents: [{ type: "file", filename: "Programa_SI_2026.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1001/mod_resource/content/1/Programa_SI_2026.pdf", filesize: 245000, mimetype: "application/pdf" }] },
        ],
      },
      {
        id: 2, name: "Unidad 1 — Introducción a los Sistemas de Información", summary: "<p>Conceptos fundamentales, clasificación y ciclo de vida.</p>",
        modules: [
          { id: 10021, name: "Diapositivas Unidad 1", modname: "resource", url: "https://frsfco.cvg.utn.edu.ar/mod/resource/view.php?id=10021",
            contents: [{ type: "file", filename: "U1_Intro_SI.pptx", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1001/mod_resource/content/1/U1_Intro_SI.pptx", filesize: 1200000, mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }] },
          { id: 10022, name: "Bibliografía recomendada — Capítulo 1", modname: "resource",
            contents: [{ type: "file", filename: "Cap1_Laudon.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1001/mod_resource/content/1/Cap1_Laudon.pdf", filesize: 3500000, mimetype: "application/pdf" }] },
          { id: 10023, name: "TP1 — Diagramas de Flujo de Datos", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10023" },
        ],
      },
      {
        id: 3, name: "Unidad 2 — Modelado de Sistemas", summary: "<p>DFD, Entidad-Relación y diagramas de estado.</p>",
        modules: [
          { id: 10031, name: "Diapositivas Unidad 2", modname: "resource",
            contents: [{ type: "file", filename: "U2_Modelado.pptx", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1001/mod_resource/content/1/U2_Modelado.pptx", filesize: 2100000, mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }] },
          { id: 10032, name: "Ejercicios prácticos — Modelado", modname: "resource",
            contents: [{ type: "file", filename: "Ejercicios_U2.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1001/mod_resource/content/1/Ejercicios_U2.pdf", filesize: 890000, mimetype: "application/pdf" }] },
          { id: 10033, name: "TP2 — Casos de Uso y Diagramas ER", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10033" },
        ],
      },
      {
        id: 4, name: "Unidad 3 — Sistemas ERP y CRM", summary: "",
        modules: [
          { id: 10041, name: "Video clase — Introducción a SAP", modname: "url", url: "https://frsfco.cvg.utn.edu.ar/mod/url/view.php?id=10041" },
          { id: 10042, name: "TP3 — Análisis de un sistema ERP real", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10042" },
        ],
      },
    ],
  },
  1002: {
    courseName: "Gestión de Proyectos — ISI 4K (2026)",
    data: [
      {
        id: 5, name: "Inicio", summary: "",
        modules: [
          { id: 10051, name: "Foro de consultas", modname: "forum", url: "https://frsfco.cvg.utn.edu.ar/mod/forum/view.php?id=10051" },
          { id: 10052, name: "Cronograma y evaluaciones", modname: "resource",
            contents: [{ type: "file", filename: "Cronograma_GP_2026.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1002/mod_resource/content/1/Cronograma_GP_2026.pdf", filesize: 180000, mimetype: "application/pdf" }] },
        ],
      },
      {
        id: 6, name: "Módulo 1 — Fundamentos de Gestión", summary: "<p>PMBOK, agile vs. waterfall.</p>",
        modules: [
          { id: 10061, name: "Material — PMBOK 7ª edición (resumen)", modname: "resource",
            contents: [{ type: "file", filename: "PMBOK7_Resumen.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1002/mod_resource/content/1/PMBOK7_Resumen.pdf", filesize: 4200000, mimetype: "application/pdf" }] },
          { id: 10062, name: "TP1 — Presentación de cronograma de proyecto", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10062" },
        ],
      },
      {
        id: 7, name: "Módulo 2 — Scrum y Kanban", summary: "",
        modules: [
          { id: 10071, name: "Guía Scrum 2020", modname: "resource",
            contents: [{ type: "file", filename: "Scrum_Guide_2020_es.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1002/mod_resource/content/1/Scrum_Guide_2020_es.pdf", filesize: 520000, mimetype: "application/pdf" }] },
          { id: 10072, name: "TP2 — Informe de avance del sprint", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10072" },
        ],
      },
    ],
  },
  1003: {
    courseName: "Seguridad Informática — ISI 4K (2026)",
    data: [
      {
        id: 8, name: "Inicio", summary: "",
        modules: [
          { id: 10081, name: "Presentación de la materia", modname: "resource",
            contents: [{ type: "file", filename: "Presentacion_SInfo.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1003/mod_resource/content/1/Presentacion_SInfo.pdf", filesize: 310000, mimetype: "application/pdf" }] },
        ],
      },
      {
        id: 9, name: "Unidad 1 — Criptografía", summary: "<p>Cifrado simétrico y asimétrico, firmas digitales.</p>",
        modules: [
          { id: 10091, name: "Diapositivas Criptografía", modname: "resource",
            contents: [{ type: "file", filename: "Criptografia.pptx", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1003/mod_resource/content/1/Criptografia.pptx", filesize: 1800000, mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }] },
          { id: 10092, name: "TP1 — Análisis de amenazas", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10092" },
        ],
      },
      {
        id: 10, name: "Unidad 2 — Seguridad en Redes", summary: "",
        modules: [
          { id: 10101, name: "Material — OWASP Top 10", modname: "resource",
            contents: [{ type: "file", filename: "OWASP_Top10_2021_es.pdf", fileurl: "https://frsfco.cvg.utn.edu.ar/pluginfile.php/1003/mod_resource/content/1/OWASP_Top10_2021_es.pdf", filesize: 2600000, mimetype: "application/pdf" }] },
          { id: 10102, name: "TP2 — Auditoría de vulnerabilidades web", modname: "assign", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10102" },
        ],
      },
    ],
  },
};

// ─── Tareas ───────────────────────────────────────────────────────────────────

export const MOCK_TAREAS = [
  // Sistemas de Información
  {
    id: "10023", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10023",
    title: "TP1 — Diagramas de Flujo de Datos",
    course: "Sistemas de Información — ISI 4K (2026)", courseId: 1001,
    open: "2026-03-16T08:00:00", due: "2026-06-20T23:59:00",
    dueLabel: "sábado, 20 de junio de 2026, 23:59",
    submitted: false, graded: false, grade: "", status: "No entregado",
  },
  {
    id: "10033", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10033",
    title: "TP2 — Casos de Uso y Diagramas ER",
    course: "Sistemas de Información — ISI 4K (2026)", courseId: 1001,
    open: "2026-04-07T08:00:00", due: "2026-05-09T23:59:00",
    dueLabel: "sábado, 9 de mayo de 2026, 23:59",
    submitted: true, graded: true, grade: "8 / 10", status: "Enviado para calificar",
  },
  {
    id: "10042", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10042",
    title: "TP3 — Análisis de un sistema ERP real",
    course: "Sistemas de Información — ISI 4K (2026)", courseId: 1001,
    open: "2026-05-19T08:00:00", due: "2026-07-04T23:59:00",
    dueLabel: "sábado, 4 de julio de 2026, 23:59",
    submitted: false, graded: false, grade: "", status: "No entregado",
  },
  // Gestión de Proyectos
  {
    id: "10062", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10062",
    title: "TP1 — Presentación de cronograma de proyecto",
    course: "Gestión de Proyectos — ISI 4K (2026)", courseId: 1002,
    open: "2026-03-17T08:00:00", due: "2026-04-14T23:59:00",
    dueLabel: "martes, 14 de abril de 2026, 23:59",
    submitted: true, graded: true, grade: "9 / 10", status: "Enviado para calificar",
  },
  {
    id: "10072", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10072",
    title: "TP2 — Informe de avance del sprint",
    course: "Gestión de Proyectos — ISI 4K (2026)", courseId: 1002,
    open: "2026-05-06T08:00:00", due: "2026-06-28T23:59:00",
    dueLabel: "domingo, 28 de junio de 2026, 23:59",
    submitted: false, graded: false, grade: "", status: "No entregado",
  },
  // Seguridad Informática
  {
    id: "10092", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10092",
    title: "TP1 — Análisis de amenazas",
    course: "Seguridad Informática — ISI 4K (2026)", courseId: 1003,
    open: "2026-04-07T08:00:00", due: "2026-07-05T23:59:00",
    dueLabel: "domingo, 5 de julio de 2026, 23:59",
    submitted: false, graded: false, grade: "", status: "No entregado",
  },
  {
    id: "10102", url: "https://frsfco.cvg.utn.edu.ar/mod/assign/view.php?id=10102",
    title: "TP2 — Auditoría de vulnerabilidades web",
    course: "Seguridad Informática — ISI 4K (2026)", courseId: 1003,
    open: "2026-05-19T08:00:00", due: "2026-07-19T23:59:00",
    dueLabel: "domingo, 19 de julio de 2026, 23:59",
    submitted: false, graded: false, grade: "", status: "No entregado",
  },
];

// ─── Chat ─────────────────────────────────────────────────────────────────────

const ME_ID = 9999;

function mockMember(id: number, fullname: string, small: string): object {
  return {
    id, fullname,
    profileurl: `https://frsfco.cvg.utn.edu.ar/user/profile.php?id=${id}`,
    profileimageurl: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullname)}&background=007aff&color=fff&size=128`,
    profileimageurlsmall: `https://ui-avatars.com/api/?name=${encodeURIComponent(small)}&background=007aff&color=fff&size=32`,
    isonline: false,
    showonlinestatus: true,
    isblocked: false,
    iscontact: true,
    isdeleted: false,
    canmessage: true,
  };
}

export const MOCK_CONVERSATIONS: MoodleConversation[] = [
  {
    id: 2001, name: "", subname: null, imageurl: null, type: 1,
    membercount: 2, ismuted: false, isfavourite: false, isread: false, unreadcount: 2,
    members: [mockMember(ME_ID, "Invitado", "I"), mockMember(301, "Prof. Alejandro Martínez", "AM")] as never[],
    messages: [{ id: 20015, useridfrom: 301, text: "<p>¿Ya leyeron el material de la unidad 3?</p>", timecreated: unixDaysAgo(0) }],
  },
  {
    id: 2002, name: "", subname: null, imageurl: null, type: 1,
    membercount: 2, ismuted: false, isfavourite: false, isread: true, unreadcount: 0,
    members: [mockMember(ME_ID, "Invitado", "I"), mockMember(302, "Juan García", "JG")] as never[],
    messages: [{ id: 20021, useridfrom: ME_ID, text: "<p>Dale, nos juntamos el jueves para repasar</p>", timecreated: unixDaysAgo(2) }],
  },
  {
    id: 2003, name: "ISI 4K — Proyectos 2026", subname: null, imageurl: null, type: 2,
    membercount: 18, ismuted: false, isfavourite: true, isread: true, unreadcount: 0,
    members: [mockMember(ME_ID, "Invitado", "I"), mockMember(303, "Laura Sánchez", "LS")] as never[],
    messages: [{ id: 20031, useridfrom: 303, text: "<p>El TP del sprint hay que subirlo antes del viernes 📌</p>", timecreated: unixDaysAgo(1) }],
  },
];

// Messages per conversation
export const MOCK_MESSAGES: Record<number, object[]> = {
  2001: [
    { id: 20010, useridfrom: ME_ID, text: "<p>Profe, tengo una consulta sobre el TP2.</p>", timecreated: unixDaysAgo(3) },
    { id: 20011, useridfrom: 301,   text: "<p>Claro, decime.</p>", timecreated: unixDaysAgo(3) },
    { id: 20012, useridfrom: ME_ID, text: "<p>El diagrama ER ¿tiene que incluir todas las entidades del dominio o solo las del módulo asignado?</p>", timecreated: unixDaysAgo(3) },
    { id: 20013, useridfrom: 301,   text: "<p>Solo las del módulo asignado, con sus relaciones directas.</p>", timecreated: unixDaysAgo(2) },
    { id: 20014, useridfrom: ME_ID, text: "<p>Perfecto, muchas gracias.</p>", timecreated: unixDaysAgo(2) },
    { id: 20015, useridfrom: 301,   text: "<p>¿Ya leyeron el material de la unidad 3?</p>", timecreated: unixDaysAgo(0) },
  ],
  2002: [
    { id: 20020, useridfrom: 302, text: "<p>¡Hola! ¿Cómo te fue en el parcial?</p>", timecreated: unixDaysAgo(5) },
    { id: 20021, useridfrom: ME_ID, text: "<p>Bastante bien, creo que aprobé. ¿Y vos?</p>", timecreated: unixDaysAgo(5) },
    { id: 20022, useridfrom: 302, text: "<p>También, igual me trabé en la última pregunta del ER.</p>", timecreated: unixDaysAgo(4) },
    { id: 20023, useridfrom: ME_ID, text: "<p>Dale, nos juntamos el jueves para repasar</p>", timecreated: unixDaysAgo(2) },
  ],
  2003: [
    { id: 20030, useridfrom: 303, text: "<p>Chicos, ¿alguien armó ya el backlog del sprint 2?</p>", timecreated: unixDaysAgo(4) },
    { id: 20031, useridfrom: 302, text: "<p>Yo empecé, lo paso al grupo</p>", timecreated: unixDaysAgo(3) },
    { id: 20032, useridfrom: ME_ID, text: "<p>Bien, yo hago las historias de usuario</p>", timecreated: unixDaysAgo(2) },
    { id: 20033, useridfrom: 303, text: "<p>El TP del sprint hay que subirlo antes del viernes 📌</p>", timecreated: unixDaysAgo(1) },
  ],
};

// Search results for non-contacts
export const MOCK_SEARCH_USERS = [
  {
    id: 401, fullname: "María López", profileurl: "https://frsfco.cvg.utn.edu.ar/user/profile.php?id=401",
    profileimageurl: "https://ui-avatars.com/api/?name=ML&background=34c759&color=fff&size=128",
    profileimageurlsmall: "https://ui-avatars.com/api/?name=ML&background=34c759&color=fff&size=32",
    isonline: false, isblocked: false, iscontact: false,
  },
  {
    id: 402, fullname: "Carlos Rodríguez", profileurl: "https://frsfco.cvg.utn.edu.ar/user/profile.php?id=402",
    profileimageurl: "https://ui-avatars.com/api/?name=CR&background=ff9500&color=fff&size=128",
    profileimageurlsmall: "https://ui-avatars.com/api/?name=CR&background=ff9500&color=fff&size=32",
    isonline: true, isblocked: false, iscontact: false,
  },
];

// ─── Sysacad ──────────────────────────────────────────────────────────────────

export const MOCK_DATOS_PERSONALES = {
  Estado: "OK",
  Legajo: "12345",
  NombreAlumno: "Invitado",
  Gruposanguineo: "0",
  NombreGrupoSanguineo: "0 positivo",
  NumeroDocumento: "40123456",
  Cuil: "20-40123456-3",
  Mail: "invitado@frsfco.utn.edu.ar",
  TelefonoFijo: "",
  Celular: "3564123456",
  IdEspecialidad: "2",
  NombreEspecialidad: "Ingeniería en Sistemas de Información",
  Plan: "2008",
  EstadoAlumno: "Activo",
};

// ─── Estado académico ─────────────────────────────────────────────────────────
// 40 materias, 27 aprobadas (5+8+8+6), 3 cursando, 10 restantes

export const MOCK_ESTADO_ACADEMICO = {
  Estado: "OK",
  resultadosAcademicos: [
    // Año 1
    { Año: "1", Plan: "2008", Materia: "1001", Nombre: "Matemática 1",                   EstadoAcademico: "Aprobada con 7 (4 hs.) Tomo 2022", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "1", Plan: "2008", Materia: "1002", Nombre: "Física 1",                        EstadoAcademico: "Aprobada con 8 (3 hs.) Tomo 2022", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "1", Plan: "2008", Materia: "1003", Nombre: "Análisis Matemático 1",           EstadoAcademico: "Aprobada con 9 (5 hs.) Tomo 2022", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "1", Plan: "2008", Materia: "1004", Nombre: "Introducción a la Ingeniería",    EstadoAcademico: "Aprobada con 9 (2 hs.) Tomo 2022", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "1", Plan: "2008", Materia: "1005", Nombre: "Química General",                 EstadoAcademico: "Aprobada con 8 (3 hs.) Tomo 2022", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    // Año 2
    { Año: "2", Plan: "2008", Materia: "2001", Nombre: "Matemática 2",                    EstadoAcademico: "Aprobada con 8 (5 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2002", Nombre: "Física 2",                        EstadoAcademico: "Aprobada con 7 (3 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2003", Nombre: "Análisis Matemático 2",           EstadoAcademico: "Aprobada con 8 (5 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2004", Nombre: "Álgebra y Geometría Analítica",   EstadoAcademico: "Aprobada con 7 (4 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2005", Nombre: "Ingeniería y Sociedad",           EstadoAcademico: "Aprobada con 9 (2 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2006", Nombre: "Electrotecnia y Máquinas",        EstadoAcademico: "Aprobada con 6 (4 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2007", Nombre: "Sistemas y Organizaciones",       EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "2", Plan: "2008", Materia: "2008", Nombre: "Probabilidad y Estadística",      EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2023", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    // Año 3
    { Año: "3", Plan: "2008", Materia: "3001", Nombre: "Paradigmas de Programación",      EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3002", Nombre: "Técnicas Digitales",              EstadoAcademico: "Aprobada con 8 (3 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3003", Nombre: "Gestión de Datos",                EstadoAcademico: "Aprobada con 9 (4 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3004", Nombre: "Comunicaciones",                  EstadoAcademico: "Aprobada con 7 (3 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3005", Nombre: "Arquitectura de Computadoras",    EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3006", Nombre: "Legislación",                     EstadoAcademico: "Aprobada con 8 (3 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3007", Nombre: "Economía",                        EstadoAcademico: "Aprobada con 7 (4 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "3", Plan: "2008", Materia: "3008", Nombre: "Ingeniería de Software",          EstadoAcademico: "Aprobada con 9 (5 hs.) Tomo 2024", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    // Año 4 — aprobadas
    { Año: "4", Plan: "2008", Materia: "4001", Nombre: "Diseño de Sistemas",              EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4002", Nombre: "Administración de Recursos",      EstadoAcademico: "Aprobada con 7 (4 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4003", Nombre: "Sistemas de Computación",         EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4004", Nombre: "Redes de Computadoras",           EstadoAcademico: "Aprobada con 8 (4 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4005", Nombre: "Sistemas Operativos",             EstadoAcademico: "Aprobada con 7 (4 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4006", Nombre: "Gestión de Proyectos de Tecnología", EstadoAcademico: "Aprobada con 8 (3 hs.) Tomo 2025", CorrelatividadExamen: "", CorrelatividadCursado: "" },
    // Año 4 — cursando (2026)
    { Año: "4", Plan: "2008", Materia: "4007", Nombre: "Sistemas de Información",        EstadoAcademico: "Cursa en 4K (2026)",                  CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4008", Nombre: "Gestión de Proyectos",            EstadoAcademico: "Cursa en 4K (2026)",                  CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "4", Plan: "2008", Materia: "4009", Nombre: "Seguridad Informática",           EstadoAcademico: "Cursa en 4K (2026)",                  CorrelatividadExamen: "", CorrelatividadCursado: "" },
    // Año 5
    { Año: "5", Plan: "2008", Materia: "5001", Nombre: "Proyecto Final",                  EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5002", Nombre: "Gestión Ambiental",               EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5003", Nombre: "Tecnología de la Información",    EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5004", Nombre: "Práctica Supervisada",            EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5005", Nombre: "Auditoria de Sistemas",           EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5006", Nombre: "Calidad de Software",             EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5007", Nombre: "Simulación",                      EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5008", Nombre: "Sistemas de Información 2",       EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5009", Nombre: "Investigación Operativa",         EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
    { Año: "5", Plan: "2008", Materia: "5010", Nombre: "Organización Empresarial",        EstadoAcademico: "",                                    CorrelatividadExamen: "", CorrelatividadCursado: "" },
  ],
};

// ─── Cursado con inasistencias ────────────────────────────────────────────────

export const MOCK_CURSADO: SysacadCursado = {
  Estado: "OK",
  Comisiones: [
    {
      AñoAcademico: "2026", Año: "4",
      CodMateria: "4007", NombreMateria: "Sistemas de Información",
      NombreComision: "4K", Aula: "Aula 12",
      Horarios: "Miércoles 21:30-23:45, Jueves 18:00-21:00",
      CantidadInasistencias: "3", CantidadJustificadas: "0",
      ClaveCampusVirtual: "SI-4K-26",
    },
    {
      AñoAcademico: "2026", Año: "4",
      CodMateria: "4008", NombreMateria: "Gestión de Proyectos",
      NombreComision: "4K", Aula: "Aula 8",
      Horarios: "Martes 18:00-21:00, Jueves 21:30-23:45",
      CantidadInasistencias: "2", CantidadJustificadas: "0",
      ClaveCampusVirtual: "GP-4K-26",
    },
    {
      AñoAcademico: "2026", Año: "4",
      CodMateria: "4009", NombreMateria: "Seguridad Informática",
      NombreComision: "4K", Aula: "Laboratorio 3",
      Horarios: "Lunes 18:00-21:00, Miércoles 18:00-21:00",
      CantidadInasistencias: "2", CantidadJustificadas: "1",
      ClaveCampusVirtual: "SInfo-4K-26",
    },
  ],
};

// ─── Inasistencias con fecha (para el heatmap) ────────────────────────────────
// Miércoles: SI + SInfo. Jueves: SI + GP. Lunes/Martes: solo SInfo / GP.
// Días con diagonal (mixto): 2026-03-11 (SI ausente, SInfo presente)
//                             2026-04-02 (GP ausente, SI presente)
//                             2026-04-23 (SI ausente, GP presente)
//                             2026-05-13 (SInfo ausente, SI presente)
//                             2026-06-04 (SI ausente, GP presente)

export const MOCK_INASISTENCIAS = {
  Materias: [
    {
      NombreMateria: "Sistemas de Información",
      Inasistencias: [
        { Fecha: "2026-03-11" }, // Wed: SI absent, SInfo present → DIAGONAL
        { Fecha: "2026-04-23" }, // Thu: SI absent, GP present → DIAGONAL
        { Fecha: "2026-06-04" }, // Thu: SI absent, GP present → DIAGONAL
      ],
    },
    {
      NombreMateria: "Gestión de Proyectos",
      Inasistencias: [
        { Fecha: "2026-04-02" }, // Thu: GP absent, SI present → DIAGONAL
        { Fecha: "2026-05-27" }, // Tue: solo GP → full red
      ],
    },
    {
      NombreMateria: "Seguridad Informática",
      Inasistencias: [
        { Fecha: "2026-03-23" }, // Mon: solo SInfo → full red
        { Fecha: "2026-05-13" }, // Wed: SInfo absent, SI present → DIAGONAL
      ],
    },
  ],
};

// ─── Avance por cantidades ────────────────────────────────────────────────────
// 2022: 5 (ingreso, se omite del ritmo)
// 2023: 8 materias aprobadas/promovidas
// 2024: 8 materias aprobadas/promovidas
// 2025: 6 materias aprobadas/promovidas
// Ritmo = (8+8+6)/3 = 7.33 mat/año · Faltan 13 → ~1.8 años → dic 2027

export const MOCK_AVANCE: SysacadAvance = {
  Estado: "OK",
  Cantidades: [
    { AnioAcademico: "2022", Total: "5",  Regulares: "0", PromocionesTP: "3", AprobacionesDirectas: "2" },
    { AnioAcademico: "2023", Total: "8",  Regulares: "0", PromocionesTP: "5", AprobacionesDirectas: "3" },
    { AnioAcademico: "2024", Total: "8",  Regulares: "0", PromocionesTP: "4", AprobacionesDirectas: "4" },
    { AnioAcademico: "2025", Total: "6",  Regulares: "0", PromocionesTP: "3", AprobacionesDirectas: "3" },
  ],
};

// ─── Exámenes ─────────────────────────────────────────────────────────────────

export const MOCK_EXAMENES: SysacadExamenes = {
  Estado: "OK",
  Examenes: [
    // Año 1 (2023) — primeros exámenes, mix de notas
    { FechaExamen: "2023-02-10", NombreMateria: "Matemática 1",                Nota: "siete" },
    { FechaExamen: "2023-02-18", NombreMateria: "Introducción a la Ingeniería", Nota: "ocho" },
    { FechaExamen: "2023-07-05", NombreMateria: "Análisis Matemático 1",       Nota: "ocho" },
    { FechaExamen: "2023-07-15", NombreMateria: "Física 1",                     Nota: "seis" },
    { FechaExamen: "2023-12-02", NombreMateria: "Química General",              Nota: "siete" },
    // Año 2 (2024) — mejor desempeño, algunas materias con notas altas
    { FechaExamen: "2024-02-08", NombreMateria: "Matemática 2",                Nota: "ocho" },
    { FechaExamen: "2024-02-22", NombreMateria: "Física 2",                     Nota: "siete" },
    { FechaExamen: "2024-03-10", NombreMateria: "Álgebra y Geometría Analítica",Nota: "nueve" },
    { FechaExamen: "2024-07-12", NombreMateria: "Análisis Matemático 2",       Nota: "ocho" },
    { FechaExamen: "2024-08-05", NombreMateria: "Probabilidad y Estadística",  Nota: "nueve" },
    { FechaExamen: "2024-08-20", NombreMateria: "Electrotecnia y Máquinas",    Nota: "seis" },
    { FechaExamen: "2024-12-10", NombreMateria: "Electrotecnia y Máquinas",    Nota: "siete" }, // Reintento
    // Año 3 (2024-2025) — más materias, variabilidad alta
    { FechaExamen: "2024-09-15", NombreMateria: "Paradigmas de Programación",  Nota: "diez" },
    { FechaExamen: "2024-10-02", NombreMateria: "Técnicas Digitales",          Nota: "ocho" },
    { FechaExamen: "2024-10-25", NombreMateria: "Comunicaciones",              Nota: "siete" },
    { FechaExamen: "2025-02-05", NombreMateria: "Gestión de Datos",            Nota: "nueve" },
    { FechaExamen: "2025-02-18", NombreMateria: "Arquitectura de Computadoras",Nota: "ocho" },
    { FechaExamen: "2025-03-12", NombreMateria: "Ingeniería de Software",      Nota: "nueve" },
    // Año 4 (2025-2026) — materias avanzadas, algunos con dificultad
    { FechaExamen: "2025-04-08", NombreMateria: "Diseño de Sistemas",          Nota: "ocho" },
    { FechaExamen: "2025-05-20", NombreMateria: "Sistemas Operativos",         Nota: "siete" },
    { FechaExamen: "2025-06-10", NombreMateria: "Redes de Computadoras",       Nota: "ocho" },
    { FechaExamen: "2025-06-25", NombreMateria: "Gestión de Proyectos de Tecnología", Nota: "nueve" },
    { FechaExamen: "2025-09-15", NombreMateria: "Sistemas de Información",     Nota: "insuficiente" }, // Intento fallido
    { FechaExamen: "2025-11-10", NombreMateria: "Sistemas de Información",     Nota: "ocho" }, // Segundo intento, aprobado
    { FechaExamen: "2025-11-28", NombreMateria: "Gestión de Proyectos",        Nota: "ocho" },
    { FechaExamen: "2025-12-15", NombreMateria: "Seguridad Informática",       Nota: "siete" },
    // 2026 (reciente) — materias del año 5, comenzando a rendir
    { FechaExamen: "2026-03-05", NombreMateria: "Tecnología de la Información",Nota: "nueve" },
    { FechaExamen: "2026-04-20", NombreMateria: "Auditoria de Sistemas",       Nota: "ocho" },
  ],
};

// ─── Plan de estudios ─────────────────────────────────────────────────────────

export const MOCK_PLAN: SysacadPlan = {
  Estado: "OK",
  Materias: [
    // Año 1
    { IdMateria: "1001", NombreMateria: "Matemática 1",              Año: "1", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "1002", NombreMateria: "Física 1",                   Año: "1", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "1003", NombreMateria: "Análisis Matemático 1",      Año: "1", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "1004", NombreMateria: "Introducción a la Ingeniería",Año: "1", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "1005", NombreMateria: "Química General",             Año: "1", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    // Año 2
    { IdMateria: "2001", NombreMateria: "Matemática 2",               Año: "2", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "2002", NombreMateria: "Física 2",                    Año: "2", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "2003", NombreMateria: "Análisis Matemático 2",       Año: "2", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "2004", NombreMateria: "Álgebra y Geometría Analítica",Año: "2", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "2005", NombreMateria: "Ingeniería y Sociedad",       Año: "2", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "2006", NombreMateria: "Electrotecnia y Máquinas",    Año: "2", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "2007", NombreMateria: "Sistemas y Organizaciones",   Año: "2", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "2008", NombreMateria: "Probabilidad y Estadística",  Año: "2", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    // Año 3
    { IdMateria: "3001", NombreMateria: "Paradigmas de Programación",  Año: "3", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "3002", NombreMateria: "Técnicas Digitales",          Año: "3", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "3003", NombreMateria: "Gestión de Datos",            Año: "3", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "3004", NombreMateria: "Comunicaciones",              Año: "3", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "3005", NombreMateria: "Arquitectura de Computadoras",Año: "3", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "3006", NombreMateria: "Legislación",                 Año: "3", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "3007", NombreMateria: "Economía",                    Año: "3", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "3008", NombreMateria: "Ingeniería de Software",      Año: "3", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    // Año 4
    { IdMateria: "4001", NombreMateria: "Diseño de Sistemas",          Año: "4", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4002", NombreMateria: "Administración de Recursos",  Año: "4", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "4003", NombreMateria: "Sistemas de Computación",     Año: "4", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4004", NombreMateria: "Redes de Computadoras",       Año: "4", Cuatrimestre: "2c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4005", NombreMateria: "Sistemas Operativos",         Año: "4", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4006", NombreMateria: "Gestión de Proyectos de Tecnología", Año: "4", Cuatrimestre: "1c", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4007", NombreMateria: "Sistemas de Información",     Año: "4", Cuatrimestre: "anual", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4008", NombreMateria: "Gestión de Proyectos",        Año: "4", Cuatrimestre: "anual", SeCursa: "S", SeRinde: "S" },
    { IdMateria: "4009", NombreMateria: "Seguridad Informática",       Año: "4", Cuatrimestre: "anual", SeCursa: "S", SeRinde: "S" },
    // Año 5
    { IdMateria: "5001", NombreMateria: "Proyecto Final",              Año: "5", Cuatrimestre: "anual", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "5002", NombreMateria: "Gestión Ambiental",           Año: "5", Cuatrimestre: "1c",    SeCursa: "S", SeRinde: "N" },
    { IdMateria: "5003", NombreMateria: "Tecnología de la Información",Año: "5", Cuatrimestre: "2c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5004", NombreMateria: "Práctica Supervisada",        Año: "5", Cuatrimestre: "anual", SeCursa: "S", SeRinde: "N" },
    { IdMateria: "5005", NombreMateria: "Auditoria de Sistemas",       Año: "5", Cuatrimestre: "1c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5006", NombreMateria: "Calidad de Software",         Año: "5", Cuatrimestre: "2c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5007", NombreMateria: "Simulación",                  Año: "5", Cuatrimestre: "1c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5008", NombreMateria: "Sistemas de Información 2",   Año: "5", Cuatrimestre: "2c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5009", NombreMateria: "Investigación Operativa",     Año: "5", Cuatrimestre: "1c",    SeCursa: "S", SeRinde: "S" },
    { IdMateria: "5010", NombreMateria: "Organización Empresarial",    Año: "5", Cuatrimestre: "2c",    SeCursa: "S", SeRinde: "S" },
  ],
};

// ─── Correlatividades ─────────────────────────────────────────────────────────

export const MOCK_CORRELATIVIDADES = {
  Estado: "OK",
  correlatividades: [
    { Año: "5", Plan: "2008", Materia: "5001", Nombre: "Proyecto Final",             CorrelatividadACumplir: "No regularizó Sistemas de Información (Ord. 1878)" },
    { Año: "5", Plan: "2008", Materia: "5003", Nombre: "Tecnología de la Información",CorrelatividadACumplir: "Puede cursar" },
    { Año: "5", Plan: "2008", Materia: "5005", Nombre: "Auditoria de Sistemas",       CorrelatividadACumplir: "Puede cursar" },
    { Año: "5", Plan: "2008", Materia: "5006", Nombre: "Calidad de Software",         CorrelatividadACumplir: "Puede cursar" },
    { Año: "5", Plan: "2008", Materia: "5007", Nombre: "Simulación",                  CorrelatividadACumplir: "Puede cursar" },
    { Año: "5", Plan: "2008", Materia: "5008", Nombre: "Sistemas de Información 2",   CorrelatividadACumplir: "No regularizó Sistemas de Información (Ord. 1878)" },
    { Año: "5", Plan: "2008", Materia: "5009", Nombre: "Investigación Operativa",     CorrelatividadACumplir: "Puede cursar" },
    { Año: "5", Plan: "2008", Materia: "5010", Nombre: "Organización Empresarial",    CorrelatividadACumplir: "Puede cursar" },
  ],
};
