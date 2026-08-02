import SysacadSwrProvider from "@/components/sysacadws/SysacadSwrProvider";

export default function SysacadLayout({ children }: { children: React.ReactNode }) {
  return <SysacadSwrProvider>{children}</SysacadSwrProvider>;
}
