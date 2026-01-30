export type TomcatJspMarker = {
  /** 1-based line number in the generated servlet .java source */
  javaLine: number;
  /** 1-based line number in the JSP/JSPF source */
  jspLine: number;
  /** JSP/JSPF path reference as emitted by the generator (often relative to webapp root) */
  jspFile?: string;
};

/**
 * Parses marker comments from Tomcat Jasper generated servlet sources.
 *
 * Real Jasper output differs across versions/configs, so this parser intentionally supports
 * multiple common comment formats.
 */
export function parseTomcatGeneratedJavaMarkers(javaSourceText: string): TomcatJspMarker[] {
  const lines = javaSourceText.split(/\r?\n/);
  const markers: TomcatJspMarker[] = [];

  // Common-ish patterns seen in generated sources (and supported by our fixtures):
  //   // line 12 "/path/to/file.jsp"
  //   //line 12 "/path/to/file.jsp"
  //   // 12 "/path/to/file.jsp"
  //   // 12
  const patterns: Array<{
    re: RegExp;
    fileGroup?: number;
    lineGroup: number;
  }> = [
    { re: /^\s*\/\/\s*line\s*(\d+)\s+"([^"]+)"\s*$/i, lineGroup: 1, fileGroup: 2 },
    { re: /^\s*\/\/\s*line\s*(\d+)\s+"([^"]+)"\s*\*\/?\s*$/i, lineGroup: 1, fileGroup: 2 },
    { re: /^\s*\/\/\s*(\d+)\s+"([^"]+)"\s*$/i, lineGroup: 1, fileGroup: 2 },
    { re: /^\s*\/\/\s*line\s*(\d+)\s*$/i, lineGroup: 1 },
    { re: /^\s*\/\/\s*(\d+)\s*$/i, lineGroup: 1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const p of patterns) {
      const m = lineText.match(p.re);
      if (!m) continue;

      const jspLineRaw = m[p.lineGroup];
      const jspLine = Number.parseInt(jspLineRaw, 10);
      if (!Number.isFinite(jspLine)) continue;

      const jspFile = p.fileGroup ? m[p.fileGroup] : undefined;

      markers.push({
        javaLine: i + 1,
        jspLine,
        jspFile,
      });
      break;
    }
  }

  return markers;
}

/**
 * Returns the most recent marker at or before the given generated Java line.
 * This is a best-effort heuristic that works well when Jasper emits one marker
 * per JSP line “region”.
 */
export function mapJavaLineToJsp(
  markers: TomcatJspMarker[],
  javaLine: number,
): { jspLine: number; jspFile?: string } | undefined {
  if (markers.length === 0) return undefined;

  // markers are naturally ordered by javaLine due to scan order.
  let lo = 0;
  let hi = markers.length - 1;
  let best: TomcatJspMarker | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = markers[mid];
    if (m.javaLine === javaLine) {
      best = m;
      break;
    }
    if (m.javaLine < javaLine) {
      best = m;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!best) return undefined;
  return { jspLine: best.jspLine, jspFile: best.jspFile };
}
