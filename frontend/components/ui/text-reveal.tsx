"use client";

import type { FC, ReactNode } from "react";
import { useRef } from "react";
import {
  motion,
  type MotionValue,
  useScroll,
  useTransform,
} from "framer-motion";

import { cn } from "@/lib/cn";
import styles from "./text-reveal.module.css";

interface TextRevealByWordProps {
  text: string;
  className?: string;
}

const TextRevealByWord: FC<TextRevealByWordProps> = ({
  text,
  className,
}) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end end"],
  });
  const words = text.split(" ");

  return (
    <div ref={targetRef} className={cn(styles.root, className)}>
      <div className={styles.sticky}>
        <p aria-label={text} className={styles.copy}>
          {words.map((word, index) => {
            const start = index / words.length;
            const end = start + 1 / words.length;

            return (
              <Word
                key={`${word}-${index}`}
                progress={scrollYProgress}
                range={[start, end]}
              >
                {word}
              </Word>
            );
          })}
        </p>
      </div>
    </div>
  );
};

interface WordProps {
  children: ReactNode;
  progress: MotionValue<number>;
  range: [number, number];
}

const Word: FC<WordProps> = ({ children, progress, range }) => {
  const opacity = useTransform(progress, range, [0, 1]);

  return (
    <span className={styles.word} aria-hidden="true">
      <span className={styles.wordGhost}>{children}</span>
      <motion.span style={{ opacity }} className={styles.wordFill}>
        {children}
      </motion.span>
    </span>
  );
};

export { TextRevealByWord };
