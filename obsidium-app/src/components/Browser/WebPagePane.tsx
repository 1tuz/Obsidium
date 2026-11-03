import './WebPagePane.css';

export function WebPagePane({ url }: { url: string }) {
  const title = new URL(url).hostname;

  return (
    <section className="q-web-page-pane" aria-label={title}>
      {/* shortcut: frame policies can block sites; replace when Tauri multiwebview is stable */}
      <iframe
        className="q-web-page-pane__frame"
        title={title}
        src={url}
        sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"
      />
    </section>
  );
}
