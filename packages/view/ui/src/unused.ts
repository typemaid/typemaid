/**
 * Stands in for the parts of the drawing library that are left out of the page
 * (every diagram type other than flowcharts, and the layout engines they use).
 */
const leftOut = (): never => {
  throw new Error('This part of the drawing library is not included in the viewer page.');
};
export const diagram = undefined;
export const render = leftOut;
export default {};
