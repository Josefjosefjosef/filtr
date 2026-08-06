/**
 * Minimal structural contract for TISA SP08001 Location Table Exchange Format v2.6.
 * Source (do not redistribute PDF): https://registr.dopravniinfo.cz/en/docs/x-format/tisa_tmc-location-table-v2.6-en.pdf
 * Verified SHA-256: 19DAA9618BCEADA72A34567A14A873A2A434DE6A425C14E584FD7A2DEAD1E3A9
 * Document: SP08001 / exchangeFormatVersion 2.6 / docVersion 24 / date 2016-12-08
 * Contains only interoperable structural identifiers (file codes, field codes, types, optionality).
 * Not an importer. Not a licensed location table.
 */
export const SP08001_SPEC_ID = "SP08001";
export const SP08001_TITLE = "TMC Location Table Exchange Format";
export const SP08001_EXCHANGE_FORMAT_VERSION = "2.6";
export const SP08001_DOCUMENT_VERSION = "24";
export const SP08001_DOCUMENT_DATE = "2016-12-08";
export const SP08001_SOURCE_URL = "https://registr.dopravniinfo.cz/en/docs/x-format/tisa_tmc-location-table-v2.6-en.pdf";
export const SP08001_SOURCE_SHA256 = "19DAA9618BCEADA72A34567A14A873A2A434DE6A425C14E584FD7A2DEAD1E3A9";
export const SP08001_PHYSICAL = Object.freeze({
  "delimiter": "semicolon",
  "quoting": "optional_double_quote",
  "emptyField": "two_successive_delimiters_no_space",
  "headerRequired": true,
  "newline": "CRLF",
  "defaultEncoding": "UTF-8",
  "alternateEncodingMentioned": "ISO-8859-15",
  "declaredEncodingSource": "README.DAT",
  "readmeEncoding": "ASCII",
  "bomRule": "UNDEFINED_BY_SP08001",
  "shortFilenameVariant": "importOrder.DAT when OS limits to 8 chars",
  "metadataFile": "README.DAT",
  "dataTableCountDeclaredInIntro": 23,
  "dataTableCountInTable42": 25,
  "authoritativeLayer": "TISA_DAT_CSV"
});
export const SP08001_README_META_FIELDS = Object.freeze([
  {
    "name": "alertLevel",
    "type": "int(1)",
    "required": true
  },
  {
    "name": "releaseDate",
    "type": "char(10)",
    "format": "dd/mm/yyyy",
    "required": true
  },
  {
    "name": "plannedNextUpdate",
    "type": "char(10)",
    "format": "dd/mm/yyyy",
    "required": true
  },
  {
    "name": "publisherName",
    "type": "char(100)",
    "required": true
  },
  {
    "name": "characterEncoding",
    "type": "char(30)",
    "required": true,
    "example": "UTF-8"
  },
  {
    "name": "exchangeFormatMajor",
    "type": "unsigned int(1)",
    "required": true
  },
  {
    "name": "exchangeFormatMinor",
    "type": "unsigned int(1)",
    "required": true
  }
]);
export const SP08001_TABLES = Object.freeze({
  "ADMINISTRATIVEAREA": {
    "code": "ADMINISTRATIVEAREA",
    "fileName": "ADMINISTRATIVEAREA.DAT",
    "importOrder": 13,
    "section": "4.4.2",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 7,
        "code": "NID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 8,
        "code": "POL_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "CLASS",
      "TCD",
      "STCD",
      "NID",
      "POL_LCD"
    ]
  },
  "CLASSES": {
    "code": "CLASSES",
    "fileName": "CLASSES.DAT",
    "importOrder": 4,
    "section": "4.4.3",
    "columns": [
      {
        "sort": 1,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CLASS"
    ]
  },
  "COUNTRIES": {
    "code": "COUNTRIES",
    "fileName": "COUNTRIES.DAT",
    "importOrder": 1,
    "section": "4.4.4",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "ECC",
        "type": "CHAR(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "CCD",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CNAME",
        "type": "CHAR(256)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "ECC",
      "CCD",
      "CNAME"
    ]
  },
  "DLR_DESC": {
    "code": "DLR_DESC",
    "fileName": "DLR_DESC.DAT",
    "importOrder": 25,
    "section": "4.4.5",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "DLR_ID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "DIR",
        "type": "CHAR(1)",
        "optional": true
      },
      {
        "sort": 5,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "DLR",
        "type": "CHAR(100)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "DLR_ID",
      "DIR",
      "LCD",
      "DLR"
    ]
  },
  "DLRS": {
    "code": "DLRS",
    "fileName": "DLRS.DAT",
    "importOrder": 24,
    "section": "4.4.6",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "DLR_ID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "NAME",
        "type": "CHAR(50)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "VERSION",
        "type": "CHAR(50)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "DLR_ID",
      "NAME",
      "VERSION"
    ]
  },
  "ERNO_BELONGS_TO_CO": {
    "code": "ERNO_BELONGS_TO_CO",
    "fileName": "ERNO_BELONGS_TO_CO.DAT",
    "importOrder": 12,
    "section": "4.4.7",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "ENO",
        "type": "CHAR(10)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "ENOID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "ENO",
      "ENOID"
    ]
  },
  "EUROROADNO": {
    "code": "EUROROADNO",
    "fileName": "EUROROADNO.DAT",
    "importOrder": 8,
    "section": "4.4.8",
    "columns": [
      {
        "sort": 1,
        "code": "ENO",
        "type": "CHAR(10)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "ECOMMENT",
        "type": "CHAR(100)",
        "optional": true
      },
      {
        "sort": 3,
        "code": "ENOID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "ENO",
      "ECOMMENT",
      "ENOID"
    ]
  },
  "INTERSECTIONS": {
    "code": "INTERSECTIONS",
    "fileName": "INTERSECTIONS.DAT",
    "importOrder": 22,
    "section": "4.4.9",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "INT_CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "INT_TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "INT_LCD",
        "type": "NUMERIC(5)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "INT_CID",
      "INT_TABCD",
      "INT_LCD"
    ]
  },
  "JUNCTIONS": {
    "code": "JUNCTIONS",
    "fileName": "JUNCTIONS.DAT",
    "importOrder": 23,
    "section": "4.4.10",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "JUNC_CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "JUNC_TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "JUNC_LCD",
        "type": "NUMERIC(5)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "JUNC_CID",
      "JUNC_TABCD",
      "JUNC_LCD"
    ]
  },
  "LANGUAGES": {
    "code": "LANGUAGES",
    "fileName": "LANGUAGES.DAT",
    "importOrder": 7,
    "section": "4.4.11",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "LID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LANGUAGE",
        "type": "CHAR(25)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "REPRESENTATION",
        "type": "CHAR(4)",
        "optional": true,
        "note": "SP08001 Table 4-15 — optional when one representation per language"
      }
    ],
    "headerCodes": [
      "CID",
      "LID",
      "LANGUAGE",
      "REPRESENTATION"
    ]
  },
  "LOCATIONCODES": {
    "code": "LOCATIONCODES",
    "fileName": "LOCATIONCODES.DAT",
    "importOrder": 3,
    "section": "4.4.12",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "ALLOCATED",
        "type": "NUMERIC(1)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "ALLOCATED"
    ]
  },
  "LOCATIONDATASETS": {
    "code": "LOCATIONDATASETS",
    "fileName": "LOCATIONDATASETS.DAT",
    "importOrder": 2,
    "section": "4.4.13",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "DCOMMENT",
        "type": "CHAR(100)",
        "optional": true
      },
      {
        "sort": 4,
        "code": "VERSION",
        "type": "CHAR(7)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "VERSIONDESCRIPTION",
        "type": "CHAR(100)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "DCOMMENT",
      "VERSION",
      "VERSIONDESCRIPTION"
    ]
  },
  "NAMES": {
    "code": "NAMES",
    "fileName": "NAMES.DAT",
    "importOrder": 9,
    "section": "4.4.14",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "LID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "NID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 4,
        "code": "NAME",
        "type": "CHAR(100)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "NCOMMENT",
        "type": "CHAR(100)",
        "optional": true
      },
      {
        "sort": 6,
        "code": "OFFICIALNAME",
        "type": "NUMERIC(1)",
        "optional": true,
        "note": "SP08001 Table 4-18 — optional [0/1]"
      }
    ],
    "headerCodes": [
      "CID",
      "LID",
      "NID",
      "NAME",
      "NCOMMENT",
      "OFFICIALNAME"
    ]
  },
  "NAMETRANSLATIONS": {
    "code": "NAMETRANSLATIONS",
    "fileName": "NAMETRANSLATIONS.DAT",
    "importOrder": 10,
    "section": "4.4.15",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "LID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "NID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 4,
        "code": "NTRANSLATION",
        "type": "CHAR(100)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "OFFICIALNAME",
        "type": "NUMERIC(1)",
        "optional": true,
        "note": "SP08001 Table 4-19 — optional [0/1]"
      }
    ],
    "headerCodes": [
      "CID",
      "LID",
      "NID",
      "NTRANSLATION",
      "OFFICIALNAME"
    ]
  },
  "OTHERAREAS": {
    "code": "OTHERAREAS",
    "fileName": "OTHERAREAS.DAT",
    "importOrder": 14,
    "section": "4.4.16",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 7,
        "code": "NID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 8,
        "code": "POL_LCD",
        "type": "NUMERIC(5)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "CLASS",
      "TCD",
      "STCD",
      "NID",
      "POL_LCD"
    ]
  },
  "POFFSETS": {
    "code": "POFFSETS",
    "fileName": "POFFSETS.DAT",
    "importOrder": 21,
    "section": "4.4.17",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "NEG_OFF_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 5,
        "code": "POS_OFF_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "NEG_OFF_LCD",
      "POS_OFF_LCD"
    ]
  },
  "POINTS": {
    "code": "POINTS",
    "fileName": "POINTS.DAT",
    "importOrder": 20,
    "section": "4.4.18",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 7,
        "code": "JUNCTIONNUMBER",
        "type": "CHAR(10)",
        "optional": true
      },
      {
        "sort": 8,
        "code": "RNID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 9,
        "code": "N1ID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 10,
        "code": "N2ID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 11,
        "code": "POL_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 12,
        "code": "OTH_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 13,
        "code": "SEG_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 14,
        "code": "ROA_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 15,
        "code": "INPOS",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 16,
        "code": "INNEG",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 17,
        "code": "OUTPOS",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 18,
        "code": "OUTNEG",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 19,
        "code": "PRESENTPOS",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 20,
        "code": "PRESENTNEG",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 21,
        "code": "DIVERSIONPOS",
        "type": "CHAR(10)",
        "optional": true
      },
      {
        "sort": 22,
        "code": "DIVERSIONNEG",
        "type": "CHAR(10)",
        "optional": true
      },
      {
        "sort": 23,
        "code": "XCOORD",
        "type": "CHAR(9)",
        "optional": false
      },
      {
        "sort": 24,
        "code": "YCOORD",
        "type": "CHAR(8)",
        "optional": false
      },
      {
        "sort": 25,
        "code": "INTERRUPTSROAD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 26,
        "code": "URBAN",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 27,
        "code": "JNID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "CLASS",
      "TCD",
      "STCD",
      "JUNCTIONNUMBER",
      "RNID",
      "N1ID",
      "N2ID",
      "POL_LCD",
      "OTH_LCD",
      "SEG_LCD",
      "ROA_LCD",
      "INPOS",
      "INNEG",
      "OUTPOS",
      "OUTNEG",
      "PRESENTPOS",
      "PRESENTNEG",
      "DIVERSIONPOS",
      "DIVERSIONNEG",
      "XCOORD",
      "YCOORD",
      "INTERRUPTSROAD",
      "URBAN",
      "JNID"
    ]
  },
  "ROAD_NETWORK_LEVEL_TYPES": {
    "code": "ROAD_NETWORK_LEVEL_TYPES",
    "fileName": "ROAD_NETWORK_LEVEL_TYPES.DAT",
    "importOrder": 16,
    "section": "4.4.19",
    "columns": [
      {
        "sort": 1,
        "code": "PES_LEV",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "PES_LEV_DESC",
        "type": "CHAR(5)",
        "optional": true
      },
      {
        "sort": 3,
        "code": "TDESC",
        "type": "CHAR(50)",
        "optional": true
      }
    ],
    "headerCodes": [
      "PES_LEV",
      "PES_LEV_DESC",
      "TDESC"
    ]
  },
  "ROADS": {
    "code": "ROADS",
    "fileName": "ROADS.DAT",
    "importOrder": 15,
    "section": "4.4.20",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 7,
        "code": "ROADNUMBER",
        "type": "CHAR(10)",
        "optional": true
      },
      {
        "sort": 8,
        "code": "RNID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 9,
        "code": "N1ID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 10,
        "code": "N2ID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 11,
        "code": "POL_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 12,
        "code": "PES_LEV",
        "type": "NUMERIC(1)",
        "optional": false
      },
      {
        "sort": 13,
        "code": "RDID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "CLASS",
      "TCD",
      "STCD",
      "ROADNUMBER",
      "RNID",
      "N1ID",
      "N2ID",
      "POL_LCD",
      "PES_LEV",
      "RDID"
    ]
  },
  "SEG_HAS_ERNO": {
    "code": "SEG_HAS_ERNO",
    "fileName": "SEG_HAS_ERNO.DAT",
    "importOrder": 19,
    "section": "4.4.21",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "ENO",
        "type": "CHAR(10)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "ENOID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "ENO",
      "ENOID"
    ]
  },
  "SEGMENTS": {
    "code": "SEGMENTS",
    "fileName": "SEGMENTS.DAT",
    "importOrder": 17,
    "section": "4.4.22",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 7,
        "code": "ROADNUMBER",
        "type": "CHAR(10)",
        "optional": true
      },
      {
        "sort": 8,
        "code": "RNID",
        "type": "NUMERIC",
        "optional": true
      },
      {
        "sort": 9,
        "code": "N1ID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 10,
        "code": "N2ID",
        "type": "NUMERIC",
        "optional": false
      },
      {
        "sort": 11,
        "code": "ROA_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 12,
        "code": "SEG_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 13,
        "code": "POL_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 14,
        "code": "RDID",
        "type": "NUMERIC",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "CLASS",
      "TCD",
      "STCD",
      "ROADNUMBER",
      "RNID",
      "N1ID",
      "N2ID",
      "ROA_LCD",
      "SEG_LCD",
      "POL_LCD",
      "RDID"
    ]
  },
  "SOFFSETS": {
    "code": "SOFFSETS",
    "fileName": "SOFFSETS.DAT",
    "importOrder": 18,
    "section": "4.4.23",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TABCD",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "LCD",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "NEG_OFF_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      },
      {
        "sort": 5,
        "code": "POS_OFF_LCD",
        "type": "NUMERIC(5)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CID",
      "TABCD",
      "LCD",
      "NEG_OFF_LCD",
      "POS_OFF_LCD"
    ]
  },
  "SUBTYPES": {
    "code": "SUBTYPES",
    "fileName": "SUBTYPES.DAT",
    "importOrder": 6,
    "section": "4.4.24",
    "columns": [
      {
        "sort": 1,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "SDESC",
        "type": "CHAR(50)",
        "optional": true
      },
      {
        "sort": 5,
        "code": "SNATCODE",
        "type": "CHAR(5)",
        "optional": true
      },
      {
        "sort": 6,
        "code": "SNATDESC",
        "type": "CHAR(50)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CLASS",
      "TCD",
      "STCD",
      "SDESC",
      "SNATCODE",
      "SNATDESC"
    ]
  },
  "SUBTYPETRANSLATION": {
    "code": "SUBTYPETRANSLATION",
    "fileName": "SUBTYPETRANSLATION.DAT",
    "importOrder": 11,
    "section": "4.4.25",
    "columns": [
      {
        "sort": 1,
        "code": "CID",
        "type": "NUMERIC(5)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "LID",
        "type": "NUMERIC(2)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 4,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 5,
        "code": "STCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 6,
        "code": "STRANSLATION",
        "type": "CHAR(100)",
        "optional": false
      }
    ],
    "headerCodes": [
      "CID",
      "LID",
      "CLASS",
      "TCD",
      "STCD",
      "STRANSLATION"
    ]
  },
  "TYPES": {
    "code": "TYPES",
    "fileName": "TYPES.DAT",
    "importOrder": 5,
    "section": "4.4.26",
    "columns": [
      {
        "sort": 1,
        "code": "CLASS",
        "type": "CHAR(1)",
        "optional": false
      },
      {
        "sort": 2,
        "code": "TCD",
        "type": "NUMERIC(3)",
        "optional": false
      },
      {
        "sort": 3,
        "code": "TDESC",
        "type": "CHAR(50)",
        "optional": true
      },
      {
        "sort": 4,
        "code": "TNATCD",
        "type": "CHAR(5)",
        "optional": true
      },
      {
        "sort": 5,
        "code": "TNATDESC",
        "type": "CHAR(50)",
        "optional": true
      }
    ],
    "headerCodes": [
      "CLASS",
      "TCD",
      "TDESC",
      "TNATCD",
      "TNATDESC"
    ]
  }
});
export const SP08001_TABLE_CODES = Object.freeze(Object.keys(SP08001_TABLES));
export const SP08001_STANDARD_TABLE_COUNT = SP08001_TABLE_CODES.length;
export const SP08001_METADATA_FILE = "README.DAT";

/** Map basenames (upper) to table codes, including 8.3 short names by import order. */
export function resolveSp08001TableCodeFromBasename(basename) {
  const b = String(basename || "").toUpperCase();
  const noExt = b.replace(/\.DAT$/i, "").replace(/\.TXT$/i, "");
  for (const code of SP08001_TABLE_CODES) {
    const t = SP08001_TABLES[code];
    if (t.fileName.toUpperCase() === b) return code;
    if (t.code === noExt) return code;
    if (String(t.importOrder) === noExt) return code;
  }
  if (noExt === "README") return "README";
  // Observed short export basename for ROAD_NETWORK_LEVEL_TYPES (RNLT) — opaque mapping only.
  if (noExt === "RNLT") return "ROAD_NETWORK_LEVEL_TYPES";
  return null;
}

export function getSp08001Table(code) {
  return SP08001_TABLES[code] || null;
}

