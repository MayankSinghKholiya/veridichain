// What's stored on IPFS: { v: 1, type: "DEGREE", enc: "<AES-GCM-base64>" }
// `type` is public (shown on credential card), `enc` is AES-256-GCM and only
// decryptable via /api/metadata/decrypt (key lives server-side in METADATA_ENC_KEY)

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
  instPlaceholder: string;
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

export interface CredMetaDetails {
  candidateName:   string;
  institutionName: string;
  issueYear:       string;
  hasBarcode:      boolean;
  barcodeValue:    string;
  documentCID:     string;

  degreeType?:  string;   // DEGREE only
  role?:        string;   // EXPERIENCE_LETTER only
  dateFrom?:    string;   // EXPERIENCE_LETTER only
  dateTo?:      string;   // EXPERIENCE_LETTER only
  courseName?:  string;   // COURSE_COMPLETION / CERTIFICATE
  title?:       string;   // ACHIEVEMENT / OTHER
}

export interface CredMetaIPFS {
  v:    number;
  type: CredDocType;
  enc:  string;   // AES-256-GCM encrypted CredMetaDetails (base64: IV + AuthTag + ciphertext)
}

export interface CredMetaDecrypted {
  type:    CredDocType;
  details: CredMetaDetails | null;   // null if decryption failed or legacy format
}
