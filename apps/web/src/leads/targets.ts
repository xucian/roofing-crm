import type { PropertySummary } from '@roofing-crm/pipeline-client';
import { formatAddress } from '../results/format-property';
import type { LeadTarget } from './use-leads';

/** A row saved from the results list is a property lead: no permit. */
export function propertyTarget(property: PropertySummary): LeadTarget {
  return {
    property_id: property.property_id,
    permit_id: '',
    label: formatAddress(property.address),
  };
}
