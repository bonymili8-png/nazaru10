import { motion } from "motion/react"

const cards = [
  { title: "React 19", desc: "UI-бібліотека" },
  { title: "Vite", desc: "Швидкий бандлер" },
  { title: "TypeScript", desc: "Типобезпека" },
  { title: "Tailwind CSS", desc: "Utility-first стилі" },
  { title: "Motion", desc: "Анімації" },
]

export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-12 p-8">
      <motion.h1
        className="text-5xl font-bold bg-gradient-to-r from-sky-400 to-fuchsia-500 bg-clip-text text-transparent"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        nazaru10
      </motion.h1>

      <motion.div
        className="flex flex-wrap justify-center gap-4 max-w-2xl"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.12 } },
        }}
      >
        {cards.map((card) => (
          <motion.div
            key={card.title}
            className="w-44 rounded-2xl bg-slate-900 ring-1 ring-slate-800 p-5 cursor-pointer"
            variants={{
              hidden: { opacity: 0, y: 20, scale: 0.95 },
              visible: { opacity: 1, y: 0, scale: 1 },
            }}
            whileHover={{ scale: 1.05, y: -4 }}
            whileTap={{ scale: 0.97 }}
          >
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <p className="text-sm text-slate-400">{card.desc}</p>
          </motion.div>
        ))}
      </motion.div>
    </main>
  )
}
