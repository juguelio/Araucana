// A4 apaisado con margen de 8 mm. El ancho y el alto dejan margen también para Carta.
const PRINT_WIDTH = "260mm";
const PRINT_HEIGHT = "184mm";

export function prepareServicePrint(root: HTMLElement) {
  const prepared: Array<{ page: HTMLElement; content: HTMLElement }> = [];

  for (const page of root.querySelectorAll<HTMLElement>("[data-fit-page='true']")) {
    const content = page.querySelector<HTMLElement>(".service-print-content");
    if (!content) continue;
    const measuring = content.cloneNode(true) as HTMLElement;
    measuring.classList.add("service-print-paper", "service-print-measure");
    measuring.style.width = PRINT_WIDTH;
    measuring.setAttribute("aria-hidden", "true");
    const limit = document.createElement("div");
    limit.style.height = PRINT_HEIGHT;
    measuring.append(limit);
    document.body.append(measuring);
    const maxHeight = limit.getBoundingClientRect().height;
    limit.remove();
    const naturalHeight = Math.ceil(measuring.getBoundingClientRect().height);
    measuring.remove();
    if (!naturalHeight || !maxHeight) continue;

    const scale = Math.min(1, maxHeight / naturalHeight);
    page.style.setProperty("--service-paper-width", PRINT_WIDTH);
    page.style.setProperty("--service-page-scale", String(scale));
    page.dataset.fitted = "true";
    content.classList.add("service-print-paper");
    prepared.push({ page, content });
  }

  return () => {
    for (const { page, content } of prepared) {
      delete page.dataset.fitted;
      page.style.removeProperty("--service-paper-width");
      page.style.removeProperty("--service-page-scale");
      content.classList.remove("service-print-paper");
    }
  };
}
