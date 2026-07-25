export type Creation = {
  title: string;
  description: string;
  image: string;
};

export type Feature = {
  icon: string;
  title: string;
  description: string;
};

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  avatar: string;
};

export const creations: Creation[] = [
  {
    title: "Prompt engineers",
    description:
      "Bridging the gap between human intent and machine understanding through expert prompt design.",
    image:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "Data scientists",
    description:
      "Turning data into actionable insights that drive intelligent innovation and growth.",
    image:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "Software engineers",
    description:
      "Building scalable and efficient systems that bring ideas to life through code.",
    image:
      "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1200&q=80",
  },
];

export const features: Feature[] = [
  {
    icon: "⚡",
    title: "Lightning-Fast Performance",
    description: "Built with speed - minimal load times and optimized.",
  },
  {
    icon: "✨",
    title: "Beautifully Designed Components",
    description: "Modern, pixel-perfect UI components ready for any project.",
  },
  {
    icon: "🔌",
    title: "Plug-and-Play Integration",
    description: "Simple setup with support for React, Next.js and Tailwind css.",
  },
];

export const testimonials: Testimonial[] = [
  {
    quote:
      "Super clean and easy to use. These Tailwind + React components saved me hours of dev time!",
    name: "Richard Nelson",
    role: "AI Content Marketer",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80",
  },
  {
    quote:
      "The design quality is top-notch. Perfect balance between simplicity and style. Highly recommend!",
    name: "Sophia Martinez",
    role: "UI/UX Designer",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80",
  },
  {
    quote:
      "Absolutely love the reusability of these components. My workflow feels 10x faster now.",
    name: "Ethan Roberts",
    role: "Frontend Developer",
    avatar:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=256&q=80",
  },
  {
    quote:
      "Clean, elegant, and efficient. These components are a dream for any modern web developer.",
    name: "Isabella Kim",
    role: "Product Designer",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
  },
  {
    quote:
      "I've tried dozens of UI kits, but this one just feels right. Everything works seamlessly.",
    name: "Liam Johnson",
    role: "Software Engineer",
    avatar:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=256&q=80",
  },
  {
    quote:
      "Brilliantly structured components with clean, modern styling. Makes development a joy!",
    name: "Ava Patel",
    role: "Full Stack Developer",
    avatar:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=256&q=80",
  },
];

export const companies = [
  "Aven",
  "Luminous",
  "Nexa",
  "Orbit",
  "Vertex",
  "Capsule",
  "Quanta",
  "Solace",
];
