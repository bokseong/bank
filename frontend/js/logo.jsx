const base = import.meta.env.BASE_URL;

export default function SchoolLogo({ className = "school-logo" }) {
  return <img className={className} src={`${base}images/bokseong_cl-transparent.png`} alt="순천 복성고 로고" />;
}
