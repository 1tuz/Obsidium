import { convertFileSrc } from '@tauri-apps/api/core';
import { fileName } from '../../modules/paths';
import './ImageFilePane.css';

export function ImageFilePane({ path }: { path: string }) {
  return (
    <section className="q-image-file-pane" aria-label={fileName(path)}>
      <img src={convertFileSrc(path)} alt={fileName(path)} />
    </section>
  );
}
