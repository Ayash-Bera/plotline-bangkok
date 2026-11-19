import type { RuleSource } from './domain';

export const RULE_SOURCES: RuleSource[] = [
  {
    id: 'bma-plan',
    title: 'Bangkok comprehensive plan, 2013',
    url: 'https://webportal.bangkok.go.th/public/user_files_editor/354/aboutcpud/2556/4law.pdf#page=15',
    clause: 'Clause 10, PDF pages 15 to 18; use branches 10(11) and 10(13), page 16; FAR, OSR and planting, page 18',
    explanation: 'Residential zone Y.3-29: FAR 2.5 and OSR 12.5%. At least half of open space is reserved for tree planting on permeable ground. Use category, qualifying public-road access and previous parcel allocations remain conditional.',
  },
  {
    id: 'mr55',
    title: 'Ministerial Regulation No. 55',
    url: 'https://webportal.bangkok.go.th/public/user_files_editor/95/ITA2566/O4/CI/ci-11.pdf',
    clause: 'Clauses 22, 33, 41, 44 and 50; PDF pages 5, 7 and 9 to 11',
    explanation: 'Road setbacks and the two-times-distance height relation use a selected straight public-road scenario. Boundary offsets are conservative design constraints. Interior clear height, roof allowances, corner exceptions and detailed applicability remain unresolved.',
  },
  {
    id: 'bma-control',
    title: 'Bangkok building-control ordinance',
    url: 'https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk24.pdf',
    clause: 'Clauses 50, 52 to 55, PDF pages 15 to 16; parking, clause 84 onward, page 27 onward',
    explanation: 'Clause 52 sets site-area open-space minima of 30% for residential and 10% for nonresidential use. Frontage qualification, continuous access, parking, fire safety and large-building classification require separate verification.',
  },
  {
    id: 'scope',
    title: 'Planning study scope',
    url: 'https://cpudgiapp.bangkok.go.th/arcgis/rest/services/GI_Platform/BMAGI_Planing/MapServer/1',
    clause: 'Official planning geometry; preliminary study limits',
    explanation: 'The official zone is a planning layer, not parcel or title evidence. The massing study does not establish permit approval.',
  },
  {
    id: 'input',
    title: 'Mapped context and scenario inputs',
    url: 'https://www.openstreetmap.org/copyright',
    clause: 'OSM context and user-editable assumptions',
    explanation: 'OSM supplies actual mapped context. Study boundary, road width, public access and untagged building heights are explicit assumptions.',
  },
];
