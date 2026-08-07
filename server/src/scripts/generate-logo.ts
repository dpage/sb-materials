/**
 * Regenerate `server/src/utils/logo.ts` from the master artwork in
 * `client/src/assets/sb-logo.png`.
 *
 * The logo is baked into the server as a base64 data URL rather than read from
 * disk, so that a deployed server has no runtime dependency on the client's
 * asset directory. That makes it committed generated code, and it needs to be
 * regenerated whenever the artwork changes: `npm run logo:generate`.
 *
 * The master file is a print-resolution 4563px wide, which is wildly more than
 * the PDF needs, since the letterhead is only ever drawn 140pt (just under two
 * inches) across. Downscaling to LOGO_WIDTH keeps it comfortably above 300dpi
 * at that size whilst shrinking the embedded copy by well over an order of
 * magnitude.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Two inches at ~300dpi, which is as much resolution as a 140pt-wide letterhead
// can possibly show.
const LOGO_WIDTH = 600;

const projectRoot = path.resolve(__dirname, '../../..');
const source = path.join(projectRoot, 'client/src/assets/sb-logo.png');
const target = path.join(projectRoot, 'server/src/utils/logo.ts');

async function main() {
  // PNG, not JPEG: the logo has an alpha channel and sits on the page
  // background. `palette` quantises it to an indexed PNG, which suits flat
  // brand artwork far better than truecolour.
  const png = await sharp(source)
    .resize({ width: LOGO_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  const contents = [
    `// Auto-generated from client/src/assets/sb-logo.png by`,
    `// server/src/scripts/generate-logo.ts - run \`npm run logo:generate\` to update.`,
    `export const SB_LOGO_DATA_URL =`,
    `  'data:image/png;base64,${png.toString('base64')}';`,
    '',
  ].join('\n');

  fs.writeFileSync(target, contents);

  const { width, height } = await sharp(png).metadata();
  console.log(`Wrote ${target}: ${width}x${height}, ${Math.round(png.length / 1024)}KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
