import { mkdir, mkdtemp, readFile, rm, writeFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packageMac } from './package-macos.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const date = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
const version = `${pkg.version}-preview.${date}.${commit}${dirty ? '.dirty' : ''}`;
const arch = process.argv[2] ?? process.arch;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) throw new Error('macOS에서 arm64 또는 x64 대상으로 실행하세요.');
const name = `BytePet-${version}-${arch}`;
const output = path.join(root, 'dist', 'preview', name);
try { await access(output); throw new Error(`Build already exists: ${output}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'bytepet-preview-'));
try {
  const bundle = await packageMac({ arch, version, out: path.join(temporary, 'packed'), overwrite: false });
  const app = path.join(output, 'BytePet.app'); execFileSync('/usr/bin/ditto', [bundle, app]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const note = `BytePet Preview — 테스트용 빌드\n\n버전: ${version}\n기준 커밋: ${commit}${dirty ? " (커밋하지 않은 변경 포함)" : ""}\n대상: macOS ${arch}\n\n설치: 실행 중인 BytePet을 종료한 뒤 BytePet.app을 Applications 폴더로 옮겨 실행하세요.\n기존 BytePet과 같은 로컬 보관함·설정을 사용합니다.\n앱의 설정 → 앱에서 preview 버전을 확인할 수 있습니다.\n\n정식 버전이 아닙니다. 로컬 ad-hoc 서명을 사용하며 Apple Developer ID 서명·공증은 포함하지 않습니다.\nGitHub Releases에 게시하지 않은 테스트용 파일입니다.\n`;
  await writeFile(path.join(output, 'PREVIEW-안내.txt'), note);
  const imageSource = path.join(temporary, 'dmg'); await mkdir(imageSource);
  // Clone the verified bundle while preserving framework symlinks.
  execFileSync('/bin/cp', ['-cR', app, path.join(imageSource, 'BytePet.app')]);
  await symlink('/Applications', path.join(imageSource, 'Applications'));
  await writeFile(path.join(imageSource, 'PREVIEW-안내.txt'), note);
  const dmg = path.join(output, `${name}.dmg`);
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', `BytePet Preview ${pkg.version}`, '-srcfolder', imageSource, '-format', 'ULMO', dmg], { stdio: 'inherit' });
  execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'inherit' });
  const checksum = execFileSync('/usr/bin/shasum', ['-a', '256', dmg], { encoding: 'utf8' }).split(/\s+/)[0];
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${checksum}  ${path.basename(dmg)}\n`);
  await writeFile(path.join(output, 'build-info.json'), JSON.stringify({ version, commit, dirty, architecture: arch, compression: 'ULMO (LZMA)', builtAt: new Date().toISOString(), signing: 'ad-hoc', notarized: false, dmg: path.basename(dmg), sha256: checksum }, null, 2) + '\n');
  console.log(JSON.stringify({ output, app, dmg, version }));
} finally { await rm(temporary, { recursive: true, force: true }); }
