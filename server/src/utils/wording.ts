// Verbatim legal wording from the original Google Forms (see reference/sample-reports).
// These strings must match the originals exactly, including their idiosyncratic
// punctuation and capitalisation - do not tidy them up.

export const UNWANTED_MATERIAL_QUESTION =
  'Unwanted Material (items that are not included in the grade being inspected - give details of the items found)';

export const CONTAMINATES_QUESTION =
  'Contaminates (give details of items found) If any medical or Hazardous Waste is found STOP Inspection and call Buyer)';

export const POST_CONSUMER_QUESTION =
  'Is the site aware of any material that is not defined as UK post consumer packaging?';

export const QUALITY_SCORE_LABEL = 'Quality Score(1 being poor 5 being excellent)';

export const VOLUME_CONSISTENCY_QUESTION =
  'If no, how does the supplier ensure all material is consistent in source & quality?';

// The original forms hardcoded 'Visy' here even when inspecting on behalf of
// another trading company; the instruction is really about whichever company
// the report is being completed for.
export function notifySiteLine(onBehalfOf?: string | null): string {
  return `If yes, the site must notify ${onBehalfOf || 'the Trading Company'} immediately`;
}

// Mirrors SITE_ASSURANCE_QUESTIONS in the client. The two are kept in step by
// hand, as the other form wording in this file already is.
export const SITE_ASSURANCE_QUESTIONS: { field: string; label: string }[] = [
  {
    field: 'staff_training_packaging',
    label: 'Training to staff on identifying packaging and non-packaging materials?',
  },
  { field: 'training_records_held', label: 'Records of training of staff?' },
  { field: 'waste_transfer_notes_sampled', label: 'Sample waste transfer notes seen?' },
  { field: 'volume_increase_significant', label: 'Any significant increase in volume processed by site?' },
  { field: 'personnel_change_significant', label: 'Any significant change in personnel?' },
  { field: 'undercover_processing', label: 'Undercover processing?' },
  { field: 'undercover_storage', label: 'Undercover storage?' },
  { field: 'grades_segregated', label: 'Grades clearly segregated?' },
  { field: 'good_housekeeping', label: 'Good general housekeeping?' },
  { field: 'hs_policy_provided', label: 'H&S policy provided?' },
  { field: 'felt_safe_on_site', label: 'Did you feel safe on site?' },
  { field: 'environmental_policy_provided', label: 'Environmental policy provided?' },
];
