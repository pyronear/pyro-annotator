// Copy shared by the two places that render a recurring object's label
// state — the list row's Label cell and the group page's header chip. One
// string so the two explanations can't drift apart.
export const UNSURE_GROUP_TIP =
  'An annotator marked this object undecidable, so no label could be derived ' +
  'from its sightings. Settle them under Classify → Done, with the "Only Unsure" filter.';
