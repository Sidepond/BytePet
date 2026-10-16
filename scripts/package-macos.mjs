import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { createIcon } from './create-icon.mjs';

export async function packageMac({ arch = process.arch, version, out, overwrite = true } = {}) {
  if (process.platform !== 'darwin') throw new Error('macOS에서 npm run package:mac을 실행해 주세요.');
  if (!['arm64', 'x64'].includes(arch)) throw new Error('지원하는 아키텍처는 arm64와 x64입니다.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  version ??= pkg.version;
  const build = path.join(root, 'build');
  await mkdir(build, { recursive: true });
  const icon = await createIcon(build);
  const staging = await mkdtemp(path.join(tmpdir(), 'bytepet-package-'));
  try {
    // Only runtime files enter the app; tests, profiles, build tools, and the
    // working repository never get copied into the shipped archive.
    await cp(path.join(root, 'desktop'), path.join(staging, 'desktop'), { recursive: true });
    await writeFile(path.join(staging, 'package.json'), JSON.stringify({
      name: pkg.name, productName: pkg.productName, version,
      description: pkg.description, type: pkg.type, main: pkg.main,
    }, null, 2) + '\n');
    const outputs = await packager({
      dir: staging, out: out ?? path.join(root, 'dist'), overwrite,
      name: 'BytePet', appBundleId: 'app.bytepet.desktop',
      platform: 'darwin', arch, electronVersion: pkg.devDependencies.electron,
      appVersion: version, buildVersion: pkg.version, icon, asar: true,
      appCategoryType: 'public.app-category.developer-tools',
      osxSign: {
        // Local builds need no Apple account. Developer ID/notarization is a
        // separate distribution step; fail the build if local signing fails.
        identity: '-', identityValidation: false, preAutoEntitlements: false,
        gatekeeperAssess: false, continueOnError: false,
        // Ad-hoc identities have no Team ID for hardened-runtime library
        // validation. Enable that runtime when adding Developer ID distribution.
        optionsForFile: () => ({ hardenedRuntime: false, entitlements: ['com.apple.security.cs.allow-jit'] }),
      },
    });
    return path.join(outputs[0], 'BytePet.app');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`완료: ${await packageMac({ arch: process.argv[2] ?? process.arch })}`);
}
