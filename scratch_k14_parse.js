import fs from 'fs';
import Kenh14Source from './src/sources/Kenh14Source.js';
const k14 = new Kenh14Source();
console.log("has preProcessHtml?", !!k14.preProcessHtml);
