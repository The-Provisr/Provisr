"use client";

import Image from "next/image";
import { useState } from "react";
import { DatabaseIcon } from "@/components/ui/icons";

// Official logo files live in public/assets/engines/. Engines without a file
// (and files that fail to load) fall back to the generic database icon tile.
const engineLogoFiles: Record<string, string> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  oracle: "oracle",
  sqlserver: "ms-sqlserver",
  "sql-server": "ms-sqlserver",
  mssql: "ms-sqlserver",
};

export function engineLogoSrc(engine: string): string | null {
  const file = engineLogoFiles[engine.toLowerCase()];
  return file ? `/assets/engines/${file}.svg` : null;
}

export function DatabaseEngineLogo({ engine }: { engine: string }) {
  const src = engineLogoSrc(engine);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        data-testid="engine-logo-fallback"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-gray-900"
      >
        <DatabaseIcon className="size-5" />
      </span>
    );
  }

  return (
    // Brand logos are drawn for light backgrounds, so the tile is literal white
    // (bg-white is remapped to a dark surface in globals.css).
    <span
      aria-hidden="true"
      className="inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{ backgroundColor: "#ffffff" }}
    >
      <Image
        alt=""
        height={28}
        src={src}
        width={28}
        unoptimized
        onError={() => setFailed(true)}
      />
    </span>
  );
}
