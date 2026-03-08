import { amazonMethods } from './amazonMethods.js';
import { appleMethods } from './appleMethods.js';
import { audiusMethods } from './audiusMethods.js';
import { deezerMethods } from './deezerMethods.js';
import { soundcloudMethods } from './soundcloudMethods.js';
import { spotifyMethods } from './spotifyMethods.js';
import { trackFactoryMethods } from './trackFactoryMethods.js';
import { urlResolverMethods } from './urlResolverMethods.js';

export const sourceMethods = {
  ...amazonMethods,
  ...appleMethods,
  ...trackFactoryMethods,
  ...audiusMethods,
  ...soundcloudMethods,
  ...deezerMethods,
  ...urlResolverMethods,
  ...spotifyMethods,
};
