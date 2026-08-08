import { describe, it, expect } from "vitest";
import { byFrequency, nextInteraction, HOT_THRESHOLD } from "../../client/src/lib/frequency";

describe("byFrequency · orden por frecuencia reutilizable", () => {
  it("ordena descendente por conteo", () => {
    const list = [
      { id: 1, viewCount: 2 },
      { id: 2, viewCount: 9 },
      { id: 3, viewCount: 5 },
    ];
    const sorted = [...list].sort(byFrequency((c) => c.viewCount, (c) => c.lastViewedAt));
    expect(sorted.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("a igual conteo gana el más recientemente activo", () => {
    const list = [
      { id: 1, viewCount: 5, lastViewedAt: "2026-08-01T00:00:00Z" },
      { id: 2, viewCount: 5, lastViewedAt: "2026-08-07T00:00:00Z" },
    ];
    const sorted = [...list].sort(byFrequency((c) => c.viewCount, (c) => c.lastViewedAt));
    expect(sorted.map((c) => c.id)).toEqual([2, 1]);
  });

  it("funciona con campos anidados (contacto → cliente)", () => {
    const contacts = [
      { id: 1, client: { viewCount: 0 } },
      { id: 2, client: { viewCount: 7 } },
      { id: 3, client: null },
    ];
    const sorted = [...contacts].sort(
      byFrequency((c) => c.client?.viewCount, (c) => c.client?.lastViewedAt)
    );
    expect(sorted.map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("resiste valores nulos o ausentes", () => {
    const list = [{ id: 1 }, { id: 2, viewCount: 3 }];
    const sorted = [...list].sort(byFrequency((c) => c.viewCount, (c) => c.lastViewedAt));
    expect(sorted.map((c) => c.id)).toEqual([2, 1]);
  });
});

describe("nextInteraction · boost en vivo del lado del cliente", () => {
  it("suma +1 mientras no cruza el umbral", () => {
    const next = nextInteraction({ viewCount: 4, cycleInteractions: 2 }, 10);
    expect(next).toEqual({ viewCount: 5, cycleInteractions: 3 });
  });

  it("al cruzar el umbral salta a maxScore + 1 (arriba del ranking)", () => {
    const next = nextInteraction({ viewCount: 3, cycleInteractions: HOT_THRESHOLD - 1 }, 10);
    expect(next).toEqual({ viewCount: 11, cycleInteractions: 5 });
  });

  it("arranca desde cero cuando faltan datos", () => {
    const next = nextInteraction({}, 7);
    expect(next).toEqual({ viewCount: 1, cycleInteractions: 1 });
  });
});