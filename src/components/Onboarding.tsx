import { useState, useEffect } from "react";
import Image from "next/image";
import { COLORS } from "@/lib/colors";

interface OnboardingStep {
  title: string;
  description: string;
  imageUrl?: string;
}

const desktopSteps: OnboardingStep[] = [
  {
    title: "Welcome to e-REC Review System!",
    description:
      "We are glad to have you on board. Here, you can easily access your assigned protocols, track your review progress, and manage your forms efficiently. Let's work together to uphold the highest ethical standards in research.",
    imageUrl: "/SPUP-final-logo.png",
  },
  {
    title: "Protocol Reviews Section",
    description:
      "Each protocol card displays essential information including the SPUP REC Code, Principal Investigator (PI), Due Date, form type, current status, and quick access to documents. You can also mark protocols as completed when done.",
    imageUrl: "/instrunctions/cards.png",
  },
  {
    title: "Quick Access Forms",
    description:
      "Access commonly used forms directly from your dashboard. This saves time and helps you quickly submit.",
    imageUrl: "/instrunctions/forms.png",
  },
  {
    title: "Reviewer Stats Summary",
    description:
      "Displays counts of total, completed, in-progress, and overdue protocols assigned to the reviewer.",
    imageUrl: "/instrunctions/analytics.png",
  },
  {
    title: "Notices & Announcements",
    description:
      "Stay updated with important announcements from the REC Chair and system updates. High priority notices will be highlighted for your attention.",
    imageUrl: "/instrunctions/alert.png",
  },
];

const mobileSteps: OnboardingStep[] = [
  {
    title: "Welcome to e-REC Review System!",
    description:
      "We are glad to have you on board. Here, you can easily access your assigned protocols, track your review progress, and manage your forms efficiently. Let's work together to uphold the highest ethical standards in research.",
    imageUrl: "/SPUP-final-logo.png",
  },
  {
    title: "Mobile Navigation",
    description:
      "Access all key features through our streamlined mobile navigation. Swipe and tap to review protocols efficiently.",
    imageUrl: "/instrunctions/mobile1.png",
  },
  {
    title: "Protocol Review on Mobile",
    description:
      "View protocol details, access documents, and submit reviews directly from your mobile device with a simplified interface.",
    imageUrl: "/instrunctions/mobile2.png",
  },
];

export default function Onboarding() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const steps = isMobile ? mobileSteps : desktopSteps;

  useEffect(() => {
    // Check if this is the first visit
    const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding");

    if (!hasSeenOnboarding) {
      setIsVisible(true);
    }

    // Check if we're on mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("hasSeenOnboarding", "true");
    setIsVisible(false);
  };

  const skipOnboarding = () => {
    completeOnboarding();
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div style={{ background: `linear-gradient(to right, ${COLORS.brand.green[700]}, ${COLORS.brand.green[600]})` }} className="p-4 text-white">
          <h2 className="text-xl font-semibold">{steps[currentStep].title}</h2>
          <div className="flex mt-3">
            {steps.map((_, index) => (
              <div 
                key={index} 
                className={`h-1 rounded-full mx-1 flex-1 ${
                  index <= currentStep ? "bg-white" : "bg-white bg-opacity-30"
                }`}
              />
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-6">
          <div className="space-y-6">
            {steps[currentStep].imageUrl && (
              <div className="flex justify-center">
                <div className="relative w-full h-64 overflow-hidden rounded-lg border border-gray-200">
                  <Image 
                    src={steps[currentStep].imageUrl} 
                    alt={steps[currentStep].title}
                    fill
                    style={{ objectFit: "contain" }}
                    className="w-full"
                  />
                </div>
              </div>
            )}
            
            <p className="text-gray-700 leading-relaxed">
              {steps[currentStep].description}
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-between">
          <div>
            {currentStep > 0 ? (
              <button 
                onClick={prevStep}
                className="px-4 py-2 border border-gray-300 rounded-md bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800"
              >
                Back
              </button>
            ) : (
              <button 
                onClick={skipOnboarding}
                className="px-4 py-2 border border-gray-300 rounded-md bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-700"
              >
                Skip Tour
              </button>
            )}
          </div>
          
          <button 
            onClick={nextStep}
            style={{ backgroundColor: COLORS.brand.green.DEFAULT }}
            className="px-6 py-2 text-white rounded-md shadow-sm hover:opacity-90 transition-opacity"
          >
            {currentStep < steps.length - 1 ? "Next" : "Get Started"}
          </button>
        </div>
      </div>
    </div>
  );
}
