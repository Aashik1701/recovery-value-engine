import { motion } from "framer-motion";
import { Link } from "react-router-dom";

/** An animatable react-router Link, lets CTA buttons get whileHover/whileTap spring feedback without losing client-side routing. */
export const MotionLink = motion.create(Link);

/** Shared tactile press/hover feel for every button-shaped CTA on the page. */
export const BUTTON_MOTION = {
  whileHover: { scale: 1.035, y: -2 },
  whileTap: { scale: 0.97, y: 0 },
  transition: { type: "spring" as const, stiffness: 400, damping: 22 },
};
