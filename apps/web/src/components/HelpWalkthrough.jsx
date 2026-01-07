import { useHelp } from '../context/HelpContext';
import OnboardingModal from './OnboardingModal';

/**
 * Global help walkthrough component.
 * Renders the OnboardingModal in "help mode" when triggered from the header.
 */
export default function HelpWalkthrough() {
  const { showWalkthrough, closeWalkthrough } = useHelp();

  if (!showWalkthrough) return null;

  return (
    <OnboardingModal
      isHelpMode={true}
      onComplete={closeWalkthrough}
    />
  );
}
