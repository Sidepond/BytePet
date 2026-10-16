# 도트 스프라이트 v2 생성 기록

도구: 내장 image_gen.imagegen. 두 요청 모두 transparent_background=true. 생성 후 24×24 논리 격자와 기존 팔레트로 규격화하고, 4배 확대하여 96×96 PNG 프레임으로 저장했다.

## 대기

참조: source/reference.png (기존 코드 기반 고양이).

```text
Create an animation sprite sheet matching the EXACT VERY COARSE PIXEL STYLE of the orange cat in the attached reference. The cat at right is the identity reference; ignore ground and scene. NOT the detailed cute pixel illustrations from other styles. Use the SAME simple blocky 24x24 logical-pixel resolution as the reference: visible BIG square pixels, one-logical-pixel dark brown outline, 2x2 eyes, small square nose, 16-pixel-wide broad rectangular head with pointed two-pixel ears, short chunky body, simple rectangular paws. Flat limited palette only: #53382f outline, #edaa55 orange, #ffd58b light gold, #cb773d stripes, #fff0ca muzzle/belly/paws, #e78d88 pink, #459b8f collar, #ffe293 bell. NO gradients, texture, highlights, gloss, smooth curves, antialiasing or tiny detail. Subject is original BytePet cheese tabby sitting front-facing, tail to viewer's right, green collar and square gold bell.
Output a transparent PNG with FOUR COLUMNS and TWO ROWS of equal square cells, 8 independent frames, overall2:1. Each cell represents a24x24 pixel canvas magnified uniformly. Ground is exact logical row23, paws identical coordinates in ALL8frames. Character occupies logical x3..22 y3..22. No scenery, shadow, text, labels or gridlines. Eight frames of a slow IDLE loop: 1 neutral;2 gentle tailtip curl;3 one-pixel chest lift;4 half blink;5 closed eyes;6 open eyes and exhale;7 tailsettles;8 EXACT same as1. Head dimensions, ear placement, feet and body scale are constant throughout. Only1-logical-pixel movement at most. Perfectly aligned frames with true transparent background. Keep coarse economical dot art very close to reference.
```

## 잠자기

참조: source/reference.png와 새로 생성한 source/idle.png.

```text
Create the SLEEP animation of the same coarse24x24 pixel cat shown in reference1 (original BytePet) and reference2 (new idle sheet). Reference1 is the authority for coarse resolution. Output ONE transparent PNG, FOUR equal columns TWO equal rows, eight equal square cells, overall2:1. Eachcell is a magnified24x24 logical grid. Match original chunky square dots: singlepixel brown outline, very few flat solid colors, rectangular ears/eyes/paws, no gloss, gradients, fine detail, texture or smooth curves. Colors: #53382f outline, #edaa55 orange, #ffd58b gold, #cb773d stripes, #fff0ca cream, #e78d88 pink, #459b8f collar, #ffe293 bell.
The cheese cat is curled sleeping, head on front paws toward left, back and tail to right. Same broad blocky head as reference, two closed eyes as simple horizontal 2pixel bars, pink square nose, green collar. Draw the HEAD, FACE, EARS, PAWS and TAIL IN EXACTLY THE SAME PIXEL COORDINATES IN ALL8CELLS. These areas must be IDENTICAL, as if copy pasted. No moving left-right. No rotating, no growing/shrinking, no changes in expression. Ground contact logical y22, bottommargin onepixel. Face centered x8, head spans x2..15, paws x3..13. Body extends right to x22. Ears near row10. Only the small patch of orange BACK/RIBCAGE to RIGHT of head changes height with breathing.
Frames1..8: back low, back rising1pixel, back rising2pixels, hold2pixels, hold2pixels, backdown1pixel, back low, back low. Head and paws remain anchored while back rises. Do not redraw head differently in eachframe. Same cat proportions, flat palette, fixedground and exact shared horizontalposition. Each of eight frames should loop without jitter. No text, Zs, particles, shadows, floor or markings outside cat. True transparent background, not a rendered checkerboard.
```
