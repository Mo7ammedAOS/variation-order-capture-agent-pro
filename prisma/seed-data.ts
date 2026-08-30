import type { ProjectRole, SystemRole } from '@prisma/client';

/**
 * Realistic seed content for one UAE fit-out contractor.
 *
 * The changes below are the ones that actually recur on Dubai fit-out jobs, and
 * two of them are deliberate near-duplicates so duplicate detection has
 * something true to find rather than something staged.
 */

export const COMPANY = {
  legalCompanyName: 'ABC Fit-Out Contracting LLC',
  displayCompanyName: 'ABC Fit-Out',
  defaultCurrency: 'AED',
  timezone: 'Asia/Dubai',
  whatsappBusinessNumber: '+971 4 000 0000',
  defaultEmailSenderName: 'ABC Fit-Out — Commercial',
  defaultEmailSenderAddress: 'vo@abcfitout.example',
};

export interface SeedUser {
  key: string;
  fullName: string;
  email: string;
  phone: string;
  systemRole: SystemRole;
  /** Separate from the job. See the Ivan Petrov row. */
  canAdministerCompany?: boolean;
}

export const USERS: SeedUser[] = [
  // Six people, deliberately. Twelve made every test a hunt for which of four
  // near-identical accounts to sign in as, and none of the extras proved
  // anything the six do not.
  //
  // The separation that matters is intact: the QS prices, the MD approves, and
  // neither of them is the person who captured it. That is what makes a
  // variation file defensible when the client's QS challenges it.
  { key: 'md',    fullName: 'Khalid Al Suwaidi',  email: 'khalid.alsuwaidi@abcfitout.example',  phone: '+971501000001', systemRole: 'managing_director' },

  // Administration sits with the administrator. It stays a FLAG rather than a
  // role, so a firm that puts it on its Finance Manager or office manager can,
  // without pretending that person's job is something else.
  { key: 'admin', fullName: 'Noura Al Blooshi',   email: 'noura.alblooshi@abcfitout.example',   phone: '+971501000002', systemRole: 'company_admin', canAdministerCompany: true },

  { key: 'qs1',   fullName: 'Suresh Iyer',        email: 'suresh.iyer@abcfitout.example',       phone: '+971501000003', systemRole: 'standard_user' },
  { key: 'pm1',   fullName: 'Daniel Okafor',      email: 'daniel.okafor@abcfitout.example',     phone: '+971501000004', systemRole: 'standard_user' },
  { key: 'pm2',   fullName: 'Mariam Al Zaabi',    email: 'mariam.alzaabi@abcfitout.example',    phone: '+971501000005', systemRole: 'standard_user' },
  { key: 'se1',   fullName: 'Ahmed Rashid',       email: 'ahmed.rashid@abcfitout.example',      phone: '+971501000006', systemRole: 'standard_user' },
  { key: 'se2',   fullName: 'Grace Mensah',       email: 'grace.mensah@abcfitout.example',      phone: '+971501000007', systemRole: 'standard_user' },
];

export interface SeedProject {
  code: string;
  name: string;
  client: string;
  consultant: string;
  location: string;
  contractNumber: string;
  value: number;
  noticePeriodDays: number;
  members: { userKey: string; role: ProjectRole }[];
}

export const PROJECTS: SeedProject[] = [
  /*
    Membership is arranged so the access rule is PROVABLE by signing in, not
    only by reading a test:

      Ahmed  (se1) is on DXB-001 and DXB-004 only  -> AUH-003 must 403
      Grace  (se2) is on DXB-002 and AUH-003 only
      Daniel (pm1) runs DXB-001 and AUH-003        -> a PM across two sites
      Mariam (pm2) runs DXB-002 and DXB-004
      Suresh (qs1) prices ALL FOUR                 -> one QS, as Osman set it
      Khalid (md)  is on none of them, and sees every one anyway, through the
                   project.viewAll capability rather than a membership row.
  */
  {
    code: 'DXB-001', name: 'DIFC Gate Avenue Office Fit-Out', client: 'Meridian Capital Partners',
    consultant: 'Aedas Interiors', location: 'Gate Avenue, DIFC, Dubai',
    contractNumber: 'ABC/2026/001', value: 18_500_000, noticePeriodDays: 28,
    members: [
      { userKey: 'pm1', role: 'project_manager' }, { userKey: 'qs1', role: 'quantity_surveyor' },
      { userKey: 'se1', role: 'site_engineer' },
    ],
  },
  {
    code: 'DXB-002', name: 'Dubai Hills Mall Flagship Retail', client: 'Levant Retail Group',
    consultant: 'Woods Bagot', location: 'Dubai Hills Mall, Dubai',
    contractNumber: 'ABC/2026/002', value: 7_200_000, noticePeriodDays: 21,
    members: [
      { userKey: 'pm2', role: 'project_manager' }, { userKey: 'qs1', role: 'quantity_surveyor' },
      { userKey: 'se2', role: 'site_engineer' },
    ],
  },
  {
    code: 'AUH-003', name: 'Al Maryah Clinic Interior Works', client: 'Gulf Health Holdings',
    consultant: 'Perkins Eastman', location: 'Al Maryah Island, Abu Dhabi',
    contractNumber: 'ABC/2026/003', value: 11_900_000, noticePeriodDays: 28,
    members: [
      { userKey: 'pm1', role: 'project_manager' }, { userKey: 'qs1', role: 'quantity_surveyor' },
      { userKey: 'se2', role: 'site_engineer' },
    ],
  },
  {
    code: 'DXB-004', name: 'Business Bay Serviced Apartments', client: 'Anchor Living FZ-LLC',
    consultant: 'Godwin Austen Johnson', location: 'Business Bay, Dubai',
    contractNumber: 'ABC/2026/004', value: 24_300_000, noticePeriodDays: 14,
    members: [
      { userKey: 'pm2', role: 'project_manager' }, { userKey: 'qs1', role: 'quantity_surveyor' },
      { userKey: 'se1', role: 'site_engineer' },
    ],
  },
];

export interface SeedChange {
  projectCode: string;
  title: string;
  description: string;
  location: string;
  trade: string;
  daysAgo: number;
  estimatedValue: number | null;
  workStarted: boolean;
  timeImpact: boolean;
  source: 'mobile_form' | 'whatsapp' | 'email' | 'site_instruction' | 'meeting';
}

export const CHANGES: SeedChange[] = [
  { projectCode: 'DXB-001', title: 'Reception feature wall changed from paint to natural stone', description: 'Client representative instructed on site that the reception feature wall behind the desk is to be clad in book-matched marble rather than the specified painted finish. Marble selection not yet issued.', location: 'Reception, Level 2', trade: 'Finishes', daysAgo: 34, estimatedValue: 285_000, workStarted: false, timeImpact: true, source: 'whatsapp' },
  // Deliberate near-duplicate of the above — different words, same change.
  { projectCode: 'DXB-001', title: 'Marble cladding to reception wall in lieu of painted finish', description: 'Consultant confirmed the reception wall behind the reception desk should be finished in natural stone cladding instead of paint. Awaiting revised drawing and stone schedule.', location: 'Reception, Level 2', trade: 'Finishes', daysAgo: 31, estimatedValue: 290_000, workStarted: false, timeImpact: true, source: 'email' },
  { projectCode: 'DXB-001', title: 'Additional power points to open plan workstations', description: 'Client requires two additional floor boxes per workstation cluster across the open plan area. Not shown on tender electrical layout.', location: 'Level 3 open plan', trade: 'Electrical', daysAgo: 22, estimatedValue: 96_000, workStarted: true, timeImpact: false, source: 'mobile_form' },
  { projectCode: 'DXB-001', title: 'Ceiling bulkhead revision at lift lobby', description: 'Revised RCP issued showing a lowered bulkhead at the lift lobby to conceal new ductwork. Original gypsum works already partially installed.', location: 'Lift lobby, Level 2', trade: 'Ceiling', daysAgo: 15, estimatedValue: 62_500, workStarted: true, timeImpact: true, source: 'email' },
  { projectCode: 'DXB-001', title: 'Civil Defence requirement for additional smoke detectors', description: 'Civil Defence inspection required additional smoke detection in the two meeting rooms and the server room. Not in the approved design.', location: 'Level 3', trade: 'Fire', daysAgo: 9, estimatedValue: 41_000, workStarted: false, timeImpact: false, source: 'site_instruction' },
  { projectCode: 'DXB-001', title: 'Joinery material change to reception desk', description: 'Interior designer changed the reception desk carcass from MDF veneer to solid walnut. Shop drawings already approved on the original spec.', location: 'Reception, Level 2', trade: 'Joinery', daysAgo: 5, estimatedValue: 148_000, workStarted: false, timeImpact: true, source: 'meeting' },
  { projectCode: 'DXB-002', title: 'Shopfront glazing upgraded to low-iron', description: 'Brand standard requires low-iron glazing to the shopfront. Tender allowed standard clear float.', location: 'Shopfront', trade: 'Finishes', daysAgo: 27, estimatedValue: 210_000, workStarted: false, timeImpact: true, source: 'email' },
  { projectCode: 'DXB-002', title: 'Landlord restricted working hours to nights only', description: 'Mall management restricted all noisy works to 22:00-06:00 with immediate effect. Programme assumed daytime access.', location: 'Whole unit', trade: 'Civil', daysAgo: 19, estimatedValue: null, workStarted: true, timeImpact: true, source: 'whatsapp' },
  { projectCode: 'DXB-002', title: 'Flooring change from porcelain to engineered timber', description: 'Client changed the back-of-house flooring to engineered timber after mock-up review.', location: 'Back of house', trade: 'Finishes', daysAgo: 12, estimatedValue: 78_000, workStarted: false, timeImpact: false, source: 'mobile_form' },
  { projectCode: 'DXB-002', title: 'Additional MEP coordination for revised kitchen layout', description: 'Revised kitchen layout requires drainage and extract rerouting. Coordination drawings to be reissued.', location: 'Kitchen', trade: 'MEP', daysAgo: 6, estimatedValue: 133_000, workStarted: false, timeImpact: true, source: 'email' },
  { projectCode: 'AUH-003', title: 'Fire alarm panel relocation', description: 'Authority required the fire alarm panel relocated to the main entrance lobby from the plant room.', location: 'Entrance lobby', trade: 'Fire', daysAgo: 41, estimatedValue: 55_000, workStarted: false, timeImpact: false, source: 'site_instruction' },
  { projectCode: 'AUH-003', title: 'Medical gas outlets added to consultation rooms', description: 'Operator added medical gas outlets to six consultation rooms not included in the tender scope.', location: 'Level 1 consultation rooms', trade: 'MEP', daysAgo: 30, estimatedValue: 320_000, workStarted: false, timeImpact: true, source: 'email' },
  { projectCode: 'AUH-003', title: 'Lighting revision to reception and waiting area', description: 'Lighting consultant issued a revised layout increasing fitting count and changing to tunable white.', location: 'Reception and waiting', trade: 'Electrical', daysAgo: 21, estimatedValue: 87_500, workStarted: true, timeImpact: false, source: 'email' },
  { projectCode: 'AUH-003', title: 'Antimicrobial wall protection added to corridors', description: 'Infection control review added wall protection to all clinical corridors. Not in the specification.', location: 'Clinical corridors', trade: 'Finishes', daysAgo: 13, estimatedValue: 64_000, workStarted: false, timeImpact: false, source: 'mobile_form' },
  { projectCode: 'AUH-003', title: 'Ceiling access hatches added for MEP maintenance', description: 'Facilities team requested additional access hatches throughout the plant-served ceilings.', location: 'Level 1', trade: 'Ceiling', daysAgo: 4, estimatedValue: 28_500, workStarted: false, timeImpact: false, source: 'whatsapp' },
  { projectCode: 'DXB-004', title: 'Balcony balustrade design changed after authority comment', description: 'Authority comment required a revised balustrade detail on all apartment balconies.', location: 'All apartment balconies', trade: 'Civil', daysAgo: 26, estimatedValue: 470_000, workStarted: false, timeImpact: true, source: 'site_instruction' },
  { projectCode: 'DXB-004', title: 'Kitchen appliance package upgraded', description: 'Client upgraded the appliance package across all 120 units after the show apartment review.', location: 'All units', trade: 'Joinery', daysAgo: 18, estimatedValue: 940_000, workStarted: false, timeImpact: true, source: 'meeting' },
  { projectCode: 'DXB-004', title: 'Additional power points to bedrooms', description: 'Client added two additional sockets per bedroom across all unit types.', location: 'All units', trade: 'Electrical', daysAgo: 11, estimatedValue: 205_000, workStarted: true, timeImpact: false, source: 'mobile_form' },
  { projectCode: 'DXB-004', title: 'Corridor carpet changed to luxury vinyl tile', description: 'Operator changed corridor floor finish from carpet to LVT for maintenance reasons.', location: 'Corridors, all levels', trade: 'Finishes', daysAgo: 3, estimatedValue: 156_000, workStarted: false, timeImpact: false, source: 'email' },
];

export const CONTACTS = [
  { projectCode: 'DXB-001', fullName: 'Fatima Al Marri', companyName: 'Meridian Capital Partners', jobTitle: 'Project Director', contactType: 'client_representative' as const, verified: true,  canRequest: true,  canInstruct: true,  canApproveCost: true,  canSign: true },
  { projectCode: 'DXB-001', fullName: 'James Whitfield', companyName: 'Aedas Interiors', jobTitle: 'Lead Interior Designer', contactType: 'interior_designer' as const, verified: true, canRequest: true, canInstruct: false, canApproveCost: false, canSign: false },
  { projectCode: 'DXB-002', fullName: 'Hana Kobayashi', companyName: 'Levant Retail Group', jobTitle: 'Retail Delivery Manager', contactType: 'client_representative' as const, verified: true, canRequest: true, canInstruct: true, canApproveCost: false, canSign: false },
  { projectCode: 'DXB-002', fullName: 'Mall Operations Desk', companyName: 'Dubai Hills Mall', jobTitle: 'Operations', contactType: 'landlord' as const, verified: false, canRequest: false, canInstruct: false, canApproveCost: false, canSign: false },
  { projectCode: 'AUH-003', fullName: 'Dr Samir Nasser', companyName: 'Gulf Health Holdings', jobTitle: 'Facilities Lead', contactType: 'client' as const, verified: true, canRequest: true, canInstruct: false, canApproveCost: true, canSign: true },
  { projectCode: 'DXB-004', fullName: 'Elena Petrova', companyName: 'Anchor Living FZ-LLC', jobTitle: 'Development Manager', contactType: 'client_representative' as const, verified: true, canRequest: true, canInstruct: true, canApproveCost: true, canSign: false },
];

export const DOCUMENT_TEMPLATES = [
  { type: 'contract' as const,      name: 'Main Contract Agreement',         number: 'ABC/2026', revision: 'A' },
  { type: 'drawing' as const,       name: 'Reception RCP',                   number: 'AR-201',   revision: 'C' },
  { type: 'drawing' as const,       name: 'Electrical Layout Level 3',       number: 'EL-301',   revision: 'B' },
  { type: 'specification' as const, name: 'Finishes Specification',          number: 'SPEC-05',  revision: 'A' },
  { type: 'boq' as const,           name: 'Priced Bill of Quantities',       number: 'BOQ-01',   revision: 'A' },
  { type: 'programme' as const,     name: 'Baseline Programme',              number: 'PRG-01',   revision: 'A' },
  { type: 'correspondence' as const, name: 'Consultant Instruction 014',     number: 'CI-014',   revision: null },
  { type: 'rfi' as const,           name: 'RFI 022 — Stone Selection',       number: 'RFI-022',  revision: null },
];
