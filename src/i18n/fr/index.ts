import common from './common';
import studio from './studio';
import stage from './stage';
import patch from './patch';
import data from './data';

/** English UI text -> French. One file per area keeps parallel edits apart. */
export const FR: Record<string, string> = {
  ...common,
  ...studio,
  ...stage,
  ...patch,
  ...data,
};
