/**
 * Entrega de tareas en Moodle (mod/assign), vía scraping — mismo enfoque que
 * `lib/moodle.ts`.  El flujo replica lo que hace el filemanager YUI del navegador:
 *
 *  1. GET  mod/assign/view.php?id={cmid}&action=editsubmission
 *     → se scrapean: sesskey, itemid del draft (files_filemanager), repo de
 *       "Subir archivo", ctx_id, límites y TODOS los hidden del form de entrega.
 *  2. POST repository/repository_ajax.php?action=upload  (multipart, 1 por archivo)
 *     → sube cada archivo al área draft (itemid).
 *  3. POST mod/assign/view.php  (urlencoded, replayando los hidden + submitbutton)
 *     → confirma la entrega (action=savesubmission).
 *
 * Endpoints/params verificados contra el HAR real (draftfiles_ajax/repository_ajax).
 */

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

export interface SubmissionContext {
  cmid: string;                         // id del módulo assign
  itemid: string;                       // draft itemid (files_filemanager)
  sesskey: string;
  clientId: string;
  ctxId: string;                        // context.id
  repoId: string;                       // repositorio "Subir un archivo"
  maxBytes: number;
  areaMaxBytes: number;
  maxFiles: number;
  author: string;
  /** Todos los <input type="hidden"> del form de entrega, para replayar el POST final. */
  formFields: Record<string, string>;
}

/** Extrae name/value de cada <input type="hidden"> de un fragmento de form. */
function parseHiddenInputs(formHtml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of formHtml.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    const value = tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
    if (name) fields[name] = value;
  }
  return fields;
}

/**
 * Paso 1: abre la página de entrega y scrapea todo el contexto necesario.
 * Lanza si la tarea no admite entrega de archivos o la sesión expiró.
 */
export async function getSubmissionContext(
  cookie: string,
  cmid: string
): Promise<SubmissionContext> {
  const url = `${MOODLE_BASE}/mod/assign/view.php?id=${cmid}&action=editsubmission`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  if (res.url.includes("/login/")) throw new Error("Sesión de Moodle expirada.");
  const html = await res.text();

  // Form de entrega (post a view.php) → hidden inputs + itemid.
  const formStart = html.search(/<form[^>]*action="[^"]*\/mod\/assign\/view\.php"[^>]*>/i);
  if (formStart === -1) {
    throw new Error("Esta tarea no admite entrega de archivos o ya fue entregada.");
  }
  const formHtml = html.slice(formStart, html.indexOf("</form>", formStart));
  const formFields = parseHiddenInputs(formHtml);

  const itemid = formFields["files_filemanager"] ?? html.match(/"itemid":(\d+)/)?.[1] ?? "";
  const sesskey = formFields["sesskey"] ?? html.match(/"sesskey":"([^"]+)"/)?.[1] ?? "";
  if (!itemid || !sesskey) {
    throw new Error("No se pudo preparar la entrega (faltan itemid/sesskey).");
  }

  // Datos del filemanager.init y de la lista de repositorios.
  const ctxId =
    html.match(/"context":\{"id":(\d+)/)?.[1] ?? html.match(/ctx_id=(\d+)/)?.[1] ?? "";
  const clientId =
    html.match(/"client_id":"([^"]+)"/)?.[1] ?? Math.random().toString(36).slice(2, 15);
  // Repositorio cuyo type es "upload" (orden en el JSON: id, name, type).
  const repoId =
    html.match(/"id":"(\d+)","name":"[^"]*","type":"upload"/)?.[1] ?? "3";
  const maxBytes = Number(html.match(/"maxbytes":"?(\d+)/)?.[1] ?? 20971520);
  const areaMaxBytes = Number(html.match(/"areamaxbytes":(-?\d+)/)?.[1] ?? -1);
  const maxFiles = Number(html.match(/"maxfiles":"?(\d+)/)?.[1] ?? 20);
  const author = html.match(/"author":"([^"]+)"/)?.[1] ?? "";

  return {
    cmid,
    itemid,
    sesskey,
    clientId,
    ctxId,
    repoId,
    maxBytes,
    areaMaxBytes,
    maxFiles,
    author,
    formFields,
  };
}

/**
 * Paso 2: sube un archivo al área draft vía repository_ajax.php?action=upload.
 * Devuelve el nombre final del archivo en el draft.
 */
export async function uploadDraftFile(
  cookie: string,
  ctx: SubmissionContext,
  file: File
): Promise<string> {
  const form = new FormData();
  form.append("repo_id", ctx.repoId);
  form.append("itemid", ctx.itemid);
  form.append("sesskey", ctx.sesskey);
  form.append("client_id", ctx.clientId);
  form.append("ctx_id", ctx.ctxId);
  form.append("env", "filemanager");
  form.append("maxbytes", String(ctx.maxBytes));
  form.append("areamaxbytes", String(ctx.areaMaxBytes));
  form.append("savepath", "/");
  form.append("title", file.name);
  form.append("author", ctx.author);
  form.append("license", "unknown");
  form.append("overwrite", "1");
  form.append("repo_upload_file", file, file.name);

  const res = await fetch(
    `${MOODLE_BASE}/repository/repository_ajax.php?action=upload`,
    { method: "POST", headers: { Cookie: cookie }, body: form }
  );
  const json = (await res.json()) as {
    error?: string;
    file?: string;
    event?: string;
    newfile?: { filename?: string };
  };
  if (json.error) throw new Error(`"${file.name}": ${json.error}`);
  // "fileexists" cuando ya había uno con ese nombre — Moodle devuelve el renombrado.
  return json.file ?? json.newfile?.filename ?? file.name;
}

/**
 * Paso 3: confirma la entrega replayando los hidden del form + submitbutton.
 * Devuelve true si Moodle no rebotó al formulario con errores.
 */
export async function submitAssignment(
  cookie: string,
  ctx: SubmissionContext
): Promise<void> {
  const body = new URLSearchParams({ ...ctx.formFields });
  body.set("files_filemanager", ctx.itemid);
  body.set("sesskey", ctx.sesskey);
  body.set("action", "savesubmission");
  body.set("submitbutton", "Guardar cambios");

  const res = await fetch(`${MOODLE_BASE}/mod/assign/view.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
    redirect: "manual",
  });

  // Éxito = Moodle redirige a la vista de la tarea (303/302). Si responde 200 con
  // el form de nuevo, hubo un error de validación.
  if (res.status !== 302 && res.status !== 303) {
    const html = await res.text().catch(() => "");
    if (html.includes("_qf__mod_assign_submission_form")) {
      throw new Error("Moodle rechazó la entrega. Revisá los archivos e intentá de nuevo.");
    }
  }
}

/**
 * Borra la entrega del alumno. Replica el form de confirmación
 * (view.php · action=removesubmission · id · sesskey · userid).
 */
export async function removeSubmission(cookie: string, cmid: string): Promise<void> {
  // 1. Página de confirmación → hidden fields del form "Continuar".
  const confirmRes = await fetch(
    `${MOODLE_BASE}/mod/assign/view.php?id=${cmid}&action=removesubmissionconfirm`,
    { headers: { Cookie: cookie } }
  );
  if (confirmRes.url.includes("/login/")) throw new Error("Sesión de Moodle expirada.");
  const html = await confirmRes.text();

  // El form de "Continuar" es el que tiene action=removesubmission.
  const formMatch = html.match(
    /<form[^>]*action="[^"]*\/mod\/assign\/view\.php"[^>]*>([\s\S]*?action="removesubmission"[\s\S]*?)<\/form>/i
  );
  const formHtml = formMatch?.[1] ?? html;
  const fields = parseHiddenInputs(formHtml);

  const body = new URLSearchParams();
  body.set("id", fields["id"] ?? cmid);
  body.set("action", "removesubmission");
  if (fields["sesskey"]) body.set("sesskey", fields["sesskey"]);
  if (fields["userid"]) body.set("userid", fields["userid"]);

  if (!body.get("sesskey")) throw new Error("No se pudo borrar la entrega (falta sesskey).");

  await fetch(`${MOODLE_BASE}/mod/assign/view.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
    redirect: "manual",
  });
}

export interface CommentItem {
  user: string;
  avatar: string;
  time: string;
  content: string;
}

export interface CommentMeta {
  itemid: string;
  contextid: string;
  component: string;
  area: string;
  courseid: string;
}

/**
 * Trae los comentarios de la entrega (comment/comment_ajax.php · action=get ·
 * area=submission_comments).  Devuelve la lista normalizada.
 */
export async function getComments(
  cookie: string,
  sesskey: string,
  meta: CommentMeta,
  page = 0
): Promise<CommentItem[]> {
  const body = new URLSearchParams({
    sesskey,
    action: "get",
    client_id: Math.random().toString(36).slice(2, 15),
    itemid: meta.itemid,
    area: meta.area,
    courseid: meta.courseid,
    contextid: meta.contextid,
    component: meta.component,
    page: String(page),
  });

  const res = await fetch(`${MOODLE_BASE}/comment/comment_ajax.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
  });
  const json = (await res.json()) as {
    list?: { fullname?: string; avatar?: string; time?: string; content?: string }[];
    error?: string;
  };
  if (json.error) throw new Error(json.error);
  return (json.list ?? []).map((c) => ({
    user: c.fullname ?? "",
    avatar: c.avatar ?? "",
    time: c.time ?? "",
    content: c.content ?? "",
  }));
}

/**
 * Publica un comentario del alumno (comment/comment_ajax.php · action=add) y
 * devuelve la lista actualizada de comentarios.
 */
export async function addComment(
  cookie: string,
  sesskey: string,
  meta: CommentMeta,
  content: string
): Promise<CommentItem[]> {
  const body = new URLSearchParams({
    sesskey,
    action: "add",
    content,
    client_id: Math.random().toString(36).slice(2, 15),
    itemid: meta.itemid,
    area: meta.area,
    courseid: meta.courseid,
    contextid: meta.contextid,
    component: meta.component,
  });

  const res = await fetch(`${MOODLE_BASE}/comment/comment_ajax.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
  });
  const json = (await res.json()) as { error?: string };
  if (json.error) throw new Error(json.error);

  // Releemos para devolver el hilo completo y consistente.
  return getComments(cookie, sesskey, meta);
}
