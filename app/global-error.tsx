"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientErrorReporter";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportClientError("critical", error.message, { stack: error.stack ?? null });
  }, [error]);

  return (
    <html>
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          <p style={{ fontSize: 17, fontWeight: 600 }}>Algo salió mal</p>
          <p style={{ fontSize: 13, color: "#8e8e93" }}>La aplicación tuvo un error inesperado.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              borderRadius: 9999,
              background: "#007aff",
              color: "white",
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 600,
              border: "none",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
