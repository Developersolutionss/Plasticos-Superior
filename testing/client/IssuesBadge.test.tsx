import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IssuesBadge from "../../client/src/components/IssuesBadge";

const issues = ["Hay otro producto activo con el mismo nombre, medida, calibre, color y densidad.", "Hay medida pero falta la Unidad de medida (pulgadas o cms)."];

describe("IssuesBadge (Revisar en Productos)", () => {
  it("sin avisos no muestra nada", () => {
    const { container } = render(<IssuesBadge issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("al pasar el mouse muestra la lista de avisos en un recuadro, y se cierra al salir", async () => {
    const user = userEvent.setup();
    render(<IssuesBadge issues={issues} />);
    const badge = screen.getByRole("button", { name: /Revisar: 2 datos no cuadran/ });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.hover(badge);
    const panel = screen.getByRole("tooltip");
    expect(panel).toHaveTextContent("Hay 2 datos que revisar");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(issues);

    await user.unhover(badge);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("al tocar queda abierto (celular) y se cierra con Escape", async () => {
    const user = userEvent.setup();
    render(<IssuesBadge issues={issues.slice(0, 1)} />);
    const badge = screen.getByRole("button", { name: /Revisar: 1 dato no cuadra/ });
    await user.click(badge);
    await user.unhover(badge);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hay un dato que revisar");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
