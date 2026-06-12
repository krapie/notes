import { useTheme } from '../App'

export default function Footer() {
  const { embed } = useTheme()
  if (embed) return null
  return (
    <footer>
      <div className="kp-footer">
        <span>© {new Date().getFullYear()} kevin park</span>
        <span className="kp-footer-pi">π</span>
      </div>
    </footer>
  )
}
