# PWA Icons

These are placeholder icons — three horizontal bars (the "stack of sets" motif) in chartreuse on the warm dark background. They work, but they're not what you'd ship to real users.

## Required files

The web manifest references these exact filenames, so keep them:

| File                | Size    | Purpose                                                                  |
| ------------------- | ------- | ------------------------------------------------------------------------ |
| `icon-192.png`      | 192×192 | Android home screen                                                      |
| `icon-512.png`      | 512×512 | High-density displays, splash screen                                     |
| `icon-maskable.png` | 512×512 | Android adaptive icon (must keep important content within the inner 80%) |
| `icon-180.png`      | 180×180 | Apple touch icon (iOS home screen)                                       |

## Generating from a logo

When you have a real logo, the easiest path is to use [realfavicongenerator.net](https://realfavicongenerator.net/) — upload one high-res source image, it produces all the variants and a manifest. Replace these files with what it gives you.

If you'd rather automate it locally, `sharp-cli` does the same job:

```bash
npx sharp-cli -i logo.png -o icon-192.png resize 192 192
npx sharp-cli -i logo.png -o icon-512.png resize 512 512
npx sharp-cli -i logo.png -o icon-180.png resize 180 180
# For maskable, ensure your logo has ~10% padding all around in the source
npx sharp-cli -i logo-padded.png -o icon-maskable.png resize 512 512
```

## Maskable safe zone

Android crops icons into various shapes (circle, squircle, etc.). Anything in the outer 20% of a maskable icon may be clipped — keep the recognizable mark within the centered 80% × 80% region.
