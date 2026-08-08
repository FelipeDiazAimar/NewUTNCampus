export interface Professor {
  id: number;
  name: string;
  avatarUrl: string | null;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Parses the "Participantes" table Moodle renders at `/user/index.php?id=N`
 * and returns only the rows whose role column contains "Profesor" (covers
 * both "Profesor" and "Profesor sin permiso de edición"). `avatarUrl` is the
 * raw Moodle URL — callers must proxy it (see `toProxyPath` in lib/moodle.ts)
 * before sending it to the client.
 */
export function parseParticipants(html: string): Professor[] {
  const tableMatch = html.match(/<table[^>]*id="participants"[^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const table = tableMatch[0];

  const rowRe =
    /<th class="cell c1"[^>]*>[\s\S]*?<a[^>]*href="[^"]*user\/view\.php\?id=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a><\/th>[\s\S]*?<td class="cell c2"[^>]*>([\s\S]*?)<\/td>/g;

  const professors: Professor[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(table))) {
    const id = parseInt(m[1], 10);
    const anchorInner = m[2];
    const role = decodeEntities(m[3].replace(/<[^>]+>/g, "")).trim();
    if (!role.includes("Profesor")) continue;

    const imgSrc = anchorInner.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? null;
    // The <span class="userinitials">DG</span> fallback avatar carries text
    // content ("DG") that must be dropped along with its tags, or it leaks
    // into the parsed name (e.g. "DGDiego Gandino").
    const withoutInitialsSpan = anchorInner.replace(/<span class="userinitials[^>]*>[\s\S]*?<\/span>/, "");
    const name = decodeEntities(withoutInitialsSpan.replace(/<[^>]+>/g, "")).trim();
    professors.push({ id, name, avatarUrl: imgSrc });
  }
  return professors;
}
