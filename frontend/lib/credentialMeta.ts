/**
 * Credential structured metadata types and display helpers.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │  What's stored on IPFS (CredMetaIPFS)                    │
 * │                                                          │
 * │  { v: 1, type: "DEGREE", enc: "<AES-GCM-base64>" }      │
 * │            ↑ PUBLIC          ↑ PRIVATE (admin only)      │
 * └──────────────────────────────────────────────────────────┘
 *
 * type  → readable by anyone (shown on credential card)
 * enc   → AES-256-GCM blob, decryptable only via the
 *          server-side /api/metadata/decrypt route
 *          (key lives in METADATA_ENC_KEY env var)
 */

// ── Document types ────────────────────────────────────────────────────────────

export type CredDocType =
  | "DEGREE"
  | "CERTIFICATE"
  | "EXPERIENCE_LETTER"
  | "COURSE_COMPLETION"
  | "ACHIEVEMENT"
  | "OTHER";

export interface CredDocMeta {
  icon:  string;
  label: string;
  short: string;
  /** placeholder for the institution name field */
  instPlaceholder: string;
  /** label for the institution name field */
  instLabel: string;
}

export const CRED_DOC_TYPES: Record<CredDocType, CredDocMeta> = {
  DEGREE: {
    icon: "🎓",
    label: "Academic Degree",
    short: "Degree",
    instLabel: "University / Institution",
    instPlaceholder: "e.g. IIT Delhi, BITS Pilani, XYZ University",
  },
  CERTIFICATE: {
    icon: "📜",
    label: "Certificate",
    short: "Certificate",
    instLabel: "Issuing Organization",
    instPlaceholder: "e.g. AWS, Google, Coursera, NASSCOM",
  },
  EXPERIENCE_LETTER: {
    icon: "💼",
    label: "Experience Letter",
    short: "Experience",
    instLabel: "Company / Organization",
    instPlaceholder: "e.g. Infosys, TCS, Startup XYZ",
  },
  COURSE_COMPLETION: {
    icon: "✅",
    label: "Course Completion",
    short: "Course",
    instLabel: "Platform / Institution",
    instPlaceholder: "e.g. Udemy, Coursera, edX, IIT Bombay Online",
  },
  ACHIEVEMENT: {
    icon: "🏆",
    label: "Achievement / Award",
    short: "Achievement",
    instLabel: "Awarding Body",
    instPlaceholder: "e.g. Ministry of Education, HackIndia",
  },
  OTHER: {
    icon: "📋",
    label: "Other Document",
    short: "Other",
    instLabel: "Issuing Organization",
    instPlaceholder: "e.g. Any institution or organization",
  },
};

// ── Encrypted private details (only admin can decrypt) ────────────────────────

export interface CredMetaDetails {
  /** Candidate's full name exactly as on the document */
  candidateName:   string;
  /** University, company, platform name */
  institutionName: string;
  /** e.g. "2023" or "June 2023" */
  issueYear:       string;
  /** Whether the document has a barcode / QR code */
  hasBarcode:      boolean;
  /** Barcode or QR code value (only if hasBarcode = true) */
  barcodeValue:    string;
  /** IPFS CID of the supporting document (PDF / image) */
  documentCID:     string;

  // ── Type-specific optional fields ──
  /** DEGREE only — e.g. "B.Tech", "MBA", "PhD" */
  degreeType?:  string;
  /** EXPERIENCE_LETTER only — job title */
  role?:        string;
  /** EXPERIENCE_LETTER only — "Jan 2022" */
  dateFrom?:    string;
  /** EXPERIENCE_LETTER only — "Dec 2023" or "Present" */
  dateTo?:      string;
  /** COURSE_COMPLETION / CERTIFICATE — course or certificate title */
  courseName?:  string;
  /** ACHIEVEMENT / OTHER — title or description */
  title?:       string;
}

// ── IPFS-stored wrapper (type is public, enc is private) ─────────────────────

export interface CredMetaIPFS {
  /** Schema version — always 1 */
  v:    number;
  /** Publicly readable document type */
  type: CredDocType;
  /** AES-256-GCM encrypted CredMetaDetails (base64: IV + AuthTag + ciphertext) */
  enc:  string;
}

// ── What the /api/metadata/decrypt route returns ──────────────────────────────

export interface CredMetaDecrypted {
  type:    CredDocType;
  /** null if decryption failed / legacy format */
  details: CredMetaDetails | null;
}
