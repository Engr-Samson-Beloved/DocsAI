import IntegrityDashboard from '../../../components/Integrity/IntegrityDashboard'

interface PageProps {
  params: Promise<{ checkId: string }>
}

export const metadata = {
  title: 'Integrity Check — WordPI',
}

export default async function IntegrityCheckPage({ params }: PageProps) {
  const { checkId } = await params
  return <IntegrityDashboard checkId={checkId} />
}
