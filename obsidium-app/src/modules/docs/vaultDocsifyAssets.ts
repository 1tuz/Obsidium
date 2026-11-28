import { resolveDocsifyAsset } from '../documents/fileGateway';
import { resolveVaultAssetUrl } from './vaultAssets';

export async function docsifyAssetUrl(workspace: string, source: string, target: string, fallback: string): Promise<string> {
  const path = await resolveDocsifyAsset(workspace, source, target);
  return path ? resolveVaultAssetUrl(workspace, path, fallback) : fallback;
}
