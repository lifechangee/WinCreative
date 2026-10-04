# Third-party notices

WinCreative itself is licensed under the **GNU Affero General Public License v3.0 or later** (see [LICENSE](LICENSE)).
It bundles or depends on the third-party components below. Licenses were verified from each package's `package.json` and
license files in `node_modules` (versions as locked in `package-lock.json` at release 0.2.0).

All licenses listed here are compatible with AGPL-3.0-or-later. No incompatible dependency was found.

## Runtime components shipped in the application

| Component | Version | License | Link |
|---|---|---|---|
| Electron (incl. Chromium, Node.js, V8, ...) | 44.4.5 | MIT (Electron); Chromium/Node components under their own permissive licenses | https://github.com/electron/electron |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| ag-psd | 31.0.2 | MIT | https://github.com/Agamnentzar/ag-psd |
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| @pdf-lib/standard-fonts (via pdf-lib) | 1.0.0 | MIT | https://github.com/Hopding/pdfkit-standard-fonts |
| @pdf-lib/upng (via pdf-lib) | 1.0.1 | MIT | https://github.com/Hopding/upng |
| UTIF.js (`utif`) | 3.1.0 | MIT | https://github.com/photopea/UTIF.js |
| pako (via pdf-lib, ag-psd, utif) | 2.1.0 | MIT AND Zlib | https://github.com/nodeca/pako |
| base64-js (via ag-psd) | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| tslib (via pdf-lib) | 2.8.1 | 0BSD | https://github.com/microsoft/tslib |
| ffmpeg-static (npm wrapper) | 5.3.0 | GPL-3.0-or-later | https://github.com/eugeneware/ffmpeg-static |
| **FFmpeg 6.1.1 Windows x64 binary** (gyan.dev "essentials" build) | 6.1.1 | **GPL-3.0** (the build enables GPL components such as libx264) | https://www.gyan.dev/ffmpeg/builds/ |

The full license texts of Electron/Chromium are shipped by the installer as `LICENSE.electron.txt` and `LICENSES.chromium.html`
next to the application executable.

### About the bundled FFmpeg

WinCreative uses FFmpeg only for **video export** (time-lapse and animation to MP4/WebM/GIF). The binary
(`ffmpeg.exe` from `ffmpeg-static`) is **not linked** into WinCreative; the application starts it as a separate process and
exchanges data over pipes and files. It is distributed alongside the application as an independent program ("mere aggregation").
GPL-3.0 and AGPL-3.0 are mutually compatible (GPL-3.0 section 13 / AGPL-3.0 section 13).

* License text of the binary: `resources/licenses/ffmpeg-GPL-3.0.txt` in the installed application (copied from
  `node_modules/ffmpeg-static/ffmpeg.exe.LICENSE`); build information: `resources/licenses/ffmpeg-README.txt`
  (`ffmpeg.exe.README`).
* **Corresponding source code** for the exact binary: FFmpeg 6.1.1, commit
  [`e38092ef93`](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93), see https://ffmpeg.org/download.html (release 6.1.1
  tarball: https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz). Build configuration and the list of third-party libraries are
  in `ffmpeg-README.txt`; the pre-built binary comes from https://www.gyan.dev/ffmpeg/builds/ and was fetched by
  `ffmpeg-static` release `b6.1.1` (https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1).
* You may replace the bundled binary with your own FFmpeg build: place it at `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`,
  or put `ffmpeg` on your `PATH` (used as a fallback when the bundled binary is missing).

## Development-only tools (not shipped)

electron-builder, electron-vite, Vite, Vitest, TypeScript, Playwright (`playwright-core`) and `@types/node` are used to build
and test the project. They are not part of the distributed application. Their licenses (MIT / Apache-2.0) are available in
each package.

## Assets

The application icon and all UI artwork were created for this project. No assets from Procreate or Savage Interactive are
included. Brush presets are original parametric definitions. "Procreate" is a trademark of Savage Interactive Pty Ltd;
WinCreative is not affiliated with or endorsed by it.
