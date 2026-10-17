export interface DisabledSection {
  id: string;
  label: string;
  /** One line on what the section would do once built. */
  summary: string;
}

/**
 * Sections that would take the CRM beyond lead identification. They are shown disabled with
 * "coming soon" (README acceptance criterion 11; docs/decisions.md §7).
 */
export const DISABLED_SECTIONS: readonly DisabledSection[] = [
  { id: 'outreach', label: 'Outreach', summary: 'Contact the owners of saved leads' },
  { id: 'campaigns', label: 'Campaigns', summary: 'Group leads into territory campaigns' },
  { id: 'sequences', label: 'Sequences', summary: 'Scheduled follow-up steps per lead' },
  { id: 'reporting', label: 'Reporting', summary: 'Lead and conversion reports' },
  { id: 'billing', label: 'Billing', summary: 'Plans, seats and invoices' },
];
