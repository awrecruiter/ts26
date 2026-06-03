import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'

const C = {
  black: '#1c1917',
  dark: '#292524',
  mid: '#57534e',
  muted: '#78716c',
  light: '#a8a29e',
  border: '#d6d3d1',
  subtle: '#e7e5e4',
  bg: '#f5f5f4',
  white: '#ffffff',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.black,
    paddingTop: 52,
    paddingBottom: 52,
    paddingHorizontal: 48,
    lineHeight: 1.5,
  },

  // ── Watermark ──────────────────────────────────────────────
  watermark: {
    position: 'absolute',
    top: 280,
    left: 80,
    width: 500,
    textAlign: 'center',
    fontSize: 64,
    fontFamily: 'Helvetica-Bold',
    color: '#e7e5e4',
    opacity: 0.4,
    transform: 'rotate(-35deg)',
    letterSpacing: 6,
  },

  // ── Page header ────────────────────────────────────────────
  pageHeader: {
    borderBottomWidth: 2,
    borderBottomColor: C.dark,
    paddingBottom: 10,
    marginBottom: 16,
    alignItems: 'center',
  },
  pageHeaderLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica',
    letterSpacing: 2,
    color: C.muted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pageHeaderTitle: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: C.dark,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  pageHeaderSolNum: {
    fontSize: 9,
    color: C.mid,
    letterSpacing: 0.5,
  },

  // ── Two-column info blocks ──────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  infoBlock: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  infoBlockHeader: {
    backgroundColor: C.dark,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  infoBlockHeaderText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  infoBlockBody: {
    padding: 8,
  },
  infoLine: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  infoLineLabel: {
    width: 90,
    fontSize: 8,
    color: C.muted,
    fontFamily: 'Helvetica-Oblique',
  },
  infoLineValue: {
    flex: 1,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
  },
  agencyName: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    marginBottom: 3,
  },
  agencyDetail: {
    fontSize: 8,
    color: C.mid,
    marginBottom: 2,
  },

  // ── Numbered sections ──────────────────────────────────────
  section: {
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  sectionNumber: {
    width: 18,
    height: 18,
    backgroundColor: C.dark,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionNumberText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.dark,
    letterSpacing: 0.3,
    flex: 1,
  },
  sectionDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    marginBottom: 8,
  },
  bullet: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 10,
    fontSize: 8,
    color: C.muted,
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: 8.5,
    color: C.black,
    lineHeight: 1.5,
  },
  bodyText: {
    fontSize: 8.5,
    color: C.mid,
    lineHeight: 1.6,
    marginBottom: 6,
    paddingLeft: 4,
    fontFamily: 'Helvetica-Oblique',
  },

  // ── Tables ─────────────────────────────────────────────────
  table: {
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: C.bg,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    backgroundColor: '#fafaf9',
  },
  tableCell: {
    flex: 1,
    padding: 5,
    fontSize: 8,
    color: C.black,
  },
  tableCellNarrow: {
    width: 120,
    padding: 5,
    fontSize: 8,
    color: C.black,
  },
  tableCellHeader: {
    flex: 1,
    padding: 5,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.mid,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tableCellHeaderNarrow: {
    width: 120,
    padding: 5,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.mid,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Footer ─────────────────────────────────────────────────
  footerBox: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: C.dark,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  footerLeft: {
    flex: 1,
  },
  footerLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  footerValue: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    marginBottom: 2,
  },
  footerDetail: {
    fontSize: 8,
    color: C.mid,
    marginBottom: 1,
  },
  footerRight: {
    alignItems: 'flex-end',
  },
  footerStatus: {
    fontSize: 7,
    letterSpacing: 1,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    color: C.muted,
    borderWidth: 0.5,
    borderColor: C.border,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.subtle,
    paddingTop: 4,
  },
  pageFooterText: {
    fontSize: 7,
    color: C.light,
  },
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function InfoLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLineLabel}>{label}</Text>
      <Text style={styles.infoLineValue}>{value}</Text>
    </View>
  )
}

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionNumber}>
        <Text style={styles.sectionNumberText}>{num}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  )
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  )
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SOWSection {
  title: string
  summary: string
  /** Narrative paragraph that synthesizes what the section means for the sub.
   *  Renders above bullets when present. */
  overview?: string
  bullets: string[]
  /** Legacy field; older SOWs used this for prose. Renderers fall back to
   *  details when overview is missing. */
  details?: string
}

interface SOWContent {
  opportunity: {
    title: string
    solicitationNumber: string
    agency: string
    naicsCode?: string | null
    setAside?: string | null
    /** Internal quote-to-prime deadline (NOT the federal response deadline). */
    quoteDeadline: string
    placeOfPerformance: string
    type?: string | null
    classificationCode?: string | null
    department?: string | null
    /** Name of the prime contractor — shown as "Quote due to {primeCompany}". */
    primeCompany?: string | null
  }
  subcontractor?: {
    name: string
    address?: string | null
    phone?: string | null
    email?: string | null
  } | null
  sections: SOWSection[]
  attachments?: { name: string; url: string }[]
  generatedAt: string
}

interface SOWPDFProps {
  content: SOWContent
  sowFileName?: string
  watermarkText?: string
  preparerCompany?: string
  preparerName?: string
  preparerTitle?: string
  status?: string
}

// ── Main PDF Component ───────────────────────────────────────────────────────

export function SOWPDF({
  content,
  watermarkText = 'DRAFT',
  preparerCompany = '[Your Company Name]',
  preparerName,
  preparerTitle,
  status = 'DRAFT',
}: SOWPDFProps) {
  const { opportunity, subcontractor, sections, generatedAt } = content

  const generatedDate = new Date(generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Agency decomposed
  const agencyParts = opportunity.agency ? opportunity.agency.split('.').filter(Boolean) : []
  const agencyName = agencyParts[agencyParts.length - 1] || opportunity.agency
  const deptHierarchy = agencyParts.slice(0, -1).join(' › ')

  return (
    <Document
      title={`SOW — ${opportunity.solicitationNumber}`}
      author={preparerCompany}
      subject={`Statement of Work: ${opportunity.title}`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* Watermark */}
        <Text style={styles.watermark} fixed>{watermarkText}</Text>

        {/* Page Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageHeaderLabel}>Statement of Work — Executive Summary</Text>
          <Text style={styles.pageHeaderTitle}>{opportunity.title}</Text>
          <Text style={styles.pageHeaderSolNum}>{opportunity.solicitationNumber}</Text>
        </View>

        {/* What We Need + Who's Asking */}
        <View style={styles.infoRow}>
          {/* What we need — sub-facing facts */}
          <View style={styles.infoBlock}>
            <View style={styles.infoBlockHeader}>
              <Text style={styles.infoBlockHeaderText}>What We Need</Text>
            </View>
            <View style={styles.infoBlockBody}>
              <InfoLine label="Item" value={opportunity.title} />
              <InfoLine label="Ship / perform at" value={opportunity.placeOfPerformance} />
              <InfoLine label="NAICS reference" value={opportunity.naicsCode} />
              <InfoLine label="Quote due" value={opportunity.quoteDeadline} />
              <InfoLine label="Quote due to" value={preparerCompany} />
              <InfoLine label="Reference" value={opportunity.solicitationNumber} />
            </View>
          </View>

          {/* Prime + sub identification */}
          <View style={styles.infoBlock}>
            <View style={styles.infoBlockHeader}>
              <Text style={styles.infoBlockHeaderText}>Prime Contractor</Text>
            </View>
            <View style={styles.infoBlockBody}>
              <Text style={styles.agencyName}>{preparerCompany}</Text>
              {preparerName && (
                <Text style={styles.agencyDetail}>
                  {preparerName}{preparerTitle ? `, ${preparerTitle}` : ''}
                </Text>
              )}
              <Text style={[styles.agencyDetail, { marginTop: 6, color: C.muted, fontSize: 7, letterSpacing: 0.5 }]}>
                END CUSTOMER
              </Text>
              <Text style={styles.agencyDetail}>{agencyName}</Text>
              {deptHierarchy ? (
                <Text style={styles.agencyDetail}>{deptHierarchy}</Text>
              ) : null}
              {subcontractor && (
                <>
                  <Text style={[styles.agencyDetail, { marginTop: 8, color: C.muted, fontSize: 7, letterSpacing: 0.5 }]}>
                    PREPARED FOR
                  </Text>
                  <Text style={[styles.agencyDetail, { fontFamily: 'Helvetica-Bold', color: C.black }]}>
                    {/* Google Places frequently returns business names with marketing taglines
                        attached after a pipe or em-dash ("Acme Corp | Best widgets in Texas").
                        Trim to the business name only. */}
                    {subcontractor.name.split(/\s*[|—–]\s*/)[0].trim()}
                  </Text>
                  {subcontractor.address && <Text style={styles.agencyDetail}>{subcontractor.address}</Text>}
                  {subcontractor.phone && <Text style={styles.agencyDetail}>{subcontractor.phone}</Text>}
                  {subcontractor.email && <Text style={styles.agencyDetail}>{subcontractor.email}</Text>}
                </>
              )}
            </View>
          </View>
        </View>

        {/* Body sections — rendered dynamically from content.sections so we
            adapt to whatever section structure the generator emits. Each
            section shows: section number + title, optional overview narrative
            paragraph (the synthesis), then the bullets (the receipts). */}
        {sections.map((section, idx) => {
          const overview = section.overview || section.details || ''
          const bullets = (section.bullets || []).filter(Boolean)
          // Strip "1.0 " / "1. " prefix from titles since we render the number separately
          const cleanTitle = section.title.replace(/^\d+(\.\d+)?[.\s]*/, '').toUpperCase()
          return (
            <View key={idx} style={styles.section} wrap={false}>
              <SectionHeader num={idx + 1} title={cleanTitle} />
              <View style={styles.sectionDivider} />
              {overview && (
                <Text style={[styles.bodyText, { marginBottom: 6 }]}>{overview}</Text>
              )}
              {bullets.slice(0, 6).map((b, i) => (
                <Bullet key={i} text={b} />
              ))}
              {!overview && bullets.length === 0 && (
                <Text style={[styles.bodyText, { color: C.muted, fontStyle: 'italic' }]}>
                  Needs detail from the solicitation.
                </Text>
              )}
            </View>
          )
        })}

        {/* Prepared By footer */}
        <View style={styles.footerBox}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>Prepared by</Text>
            <Text style={styles.footerValue}>{preparerCompany}</Text>
            {preparerName && (
              <Text style={styles.footerDetail}>
                {preparerName}{preparerTitle ? `, ${preparerTitle}` : ''}
              </Text>
            )}
            <Text style={styles.footerDetail}>Date: {generatedDate}</Text>
          </View>
          <View style={styles.footerRight}>
            <Text style={styles.footerStatus}>{status}</Text>
          </View>
        </View>

        {/* Running footer */}
        <View style={styles.pageFooter} fixed>
          <Text style={styles.pageFooterText}>
            {opportunity.solicitationNumber} — USHER
          </Text>
          <Text
            style={styles.pageFooterText}
            render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
