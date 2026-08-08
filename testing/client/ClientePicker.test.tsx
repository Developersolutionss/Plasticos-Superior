import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClientePicker from "../../client/src/components/ClientePicker";

const CLIENTS = [
  { id: 4, name: "Delta", viewCount: 4, lastViewedAt: null, avatarUrl: null },
  { id: 1, name: "Alfa", viewCount: 10, lastViewedAt: "2026-08-01T00:00:00Z", avatarUrl: null },
  { id: 3, name: "Charlie", viewCount: 5, lastViewedAt: "2026-08-02T00:00:00Z", avatarUrl: null },
  { id: 2, name: "Bravo", viewCount: 9, lastViewedAt: "2026-08-07T00:00:00Z", avatarUrl: "http://x/bravo.png" },
  { id: 5, name: "Cobre", viewCount: 8, lastViewedAt: null, avatarUrl: null },
];

function optionSpans() {
  return screen.getAllByRole("button").map((b) => b.querySelector("span")?.textContent);
}

function Harness({ onChange = () => {} }: { onChange?: (id: number | null) => void }) {
  const [id, setId] = useState<number | null>(null);
  return (
    <ClientePicker
      clients={CLIENTS}
      value={id}
      onChange={(next) => {
        setId(next);
        onChange(next);
      }}
    />
  );
}

describe("ClientePicker", () => {
  it("con el campo vacío sugiere 4 clientes por frecuencia (top viewCount)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Buscar cliente"));
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(optionSpans()).toEqual(["Alfa", "Bravo", "Cobre", "Charlie"]);
  });

  it("a partir del 1er carácter busca por coincidencia y mantiene 4 slots", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Buscar cliente"), "c");
    expect(optionSpans()).toEqual(["Cobre", "Charlie"]);
  });

  it("seleccionar un cliente lo fija, muestra su pfp y permite limpiar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByLabelText("Buscar cliente"));
    await user.click(await screen.findByRole("button", { name: /Bravo/i }));

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.getByAltText("Bravo")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Quitar cliente"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("se cierra con la tecla Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Buscar cliente"));
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
