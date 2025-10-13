/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Lotas Inc. All rights reserved.
 *  Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const RUNTIME_ICONS: Record<string, string> = {
	'python': `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" id="Layer_2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 100 100" enable-background="new 0 0 100 100" xml:space="preserve">
<linearGradient id="path1948_00000071526733124438898100000001732512360045835445_" gradientUnits="userSpaceOnUse" x1="732.4655" y1="-296.523" x2="826.8008" y2="-377.6859" gradientTransform="matrix(0.5625 0 0 -0.568 -412.6414 -165.0309)">
	<stop  offset="0" style="stop-color:#5C9FD3"/>
	<stop  offset="1" style="stop-color:#316A99"/>
</linearGradient>
<path id="path1948" fill="url(#path1948_00000071526733124438898100000001732512360045835445_)" d="M49.3,0.6c-4,0-7.8,0.4-11.1,0.9
	c-9.8,1.7-11.6,5.4-11.6,12.1v8.8h23.2v2.9H26.6h-8.7c-6.7,0-12.6,4.1-14.5,11.8c-2.1,8.8-2.2,14.4,0,23.6C5,67.6,9,72.5,15.7,72.5
	h8V61.9c0-7.7,6.6-14.4,14.5-14.4h23.2c6.5,0,11.6-5.3,11.6-11.8V13.6c0-6.3-5.3-11-11.6-12.1C57.4,0.9,53.2,0.6,49.3,0.6z
	 M36.7,7.7c2.4,0,4.4,2,4.4,4.4c0,2.4-2,4.4-4.4,4.4c-2.4,0-4.4-2-4.4-4.4C32.4,9.7,34.3,7.7,36.7,7.7z"/>
<linearGradient id="path1950_00000115508837870230036860000012441612979432214151_" gradientUnits="userSpaceOnUse" x1="863.2715" y1="-426.8091" x2="829.5844" y2="-379.1477" gradientTransform="matrix(0.5625 0 0 -0.568 -412.6414 -165.0309)">
	<stop  offset="0" style="stop-color:#FFD53D"/>
	<stop  offset="1" style="stop-color:#FEE875"/>
</linearGradient>
<path id="path1950" fill="url(#path1950_00000115508837870230036860000012441612979432214151_)" d="M75.9,25.4v10.3
	c0,8-6.8,14.7-14.5,14.7H38.2c-6.3,0-11.6,5.4-11.6,11.8v22.1c0,6.3,5.5,10,11.6,11.8c7.3,2.2,14.4,2.5,23.2,0
	C67.2,94.4,73,91,73,84.3v-8.8H49.8v-2.9H73h11.6c6.7,0,9.3-4.7,11.6-11.8c2.4-7.3,2.3-14.3,0-23.6c-1.7-6.7-4.8-11.8-11.6-11.8
	L75.9,25.4z M62.8,81.4c2.4,0,4.4,2,4.4,4.4c0,2.4-1.9,4.4-4.4,4.4c-2.4,0-4.4-2-4.4-4.4C58.5,83.3,60.4,81.4,62.8,81.4z"/>
</svg>`,
	'r': `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="linear-gradient" x1="-48.93" y1="150.88" x2="-48.8" y2="150.74" gradientTransform="translate(35285.51 72877.49) scale(721.09 -482.94)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ccced0"/>
      <stop offset="1" stop-color="#85848c"/>
    </linearGradient>
    <linearGradient id="linear-gradient-2" x1="-49.53" y1="151.17" x2="-49.39" y2="151.03" gradientTransform="translate(19751 61428.67) scale(398 -406.12)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#336db6"/>
      <stop offset="1" stop-color="#1c5eaa"/>
    </linearGradient>
  </defs>
  <path d="m50,77.95C22.84,77.95.81,63.21.81,45.01S22.84,12.07,50,12.07s49.19,14.75,49.19,32.94-22.02,32.94-49.19,32.94Zm7.53-53c-20.65,0-37.39,10.08-37.39,22.52s16.74,22.52,37.39,22.52,35.88-6.89,35.88-22.52-15.24-22.52-35.88-22.52Z" style="fill: url(#linear-gradient); fill-rule: evenodd;"/>
  <path d="m75.72,63.09s2.98.9,4.71,1.77c.6.3,1.64.91,2.39,1.71.73.78,1.09,1.57,1.09,1.57l11.73,19.78h-18.96s-8.87-16.64-8.87-16.64c0,0-1.82-3.12-2.93-4.02-.93-.75-1.33-1.02-2.25-1.02h-4.51v21.69s-16.78,0-16.78,0v-55.4h33.7s15.35.28,15.35,14.88-14.67,15.69-14.67,15.69Zm-7.3-18.55h-10.16s0,9.41,0,9.41h10.16s4.71-.02,4.71-4.8-4.71-4.62-4.71-4.62Z" style="fill: url(#linear-gradient-2); fill-rule: evenodd;"/>
</svg>`
};

export function getRuntimeIconBase64(languageId: string): string | undefined {
	const svg = RUNTIME_ICONS[languageId];
	if (!svg) {
		return undefined;
	}
	return btoa(svg);
}

