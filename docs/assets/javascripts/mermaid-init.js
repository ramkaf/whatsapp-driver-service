import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  flowchart: {
    htmlLabels: true,
    curve: "linear",
  },
});

document$.subscribe(async () => {
  await mermaid.run({
    querySelector: ".mermaid:not([data-processed])",
  });
});