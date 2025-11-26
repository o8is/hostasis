import React from 'react';

interface InfoCard {
  step: string;
  title: string;
  description: string;
}

const infoCards: InfoCard[] = [
  {
    step: "1",
    title: "Reserve",
    description: "Create a reserve with DAI (and soon ETH, USDC, or fiat) in a yield vault."
  },
  {
    step: "2",
    title: "Earn",
    description: "Your reserve earns yield automatically - your funds never leave the vault."
  },
  {
    step: "3",
    title: "Auto-Fund",
    description: "Hostasis harvests that yield and converts it into Swarm postage to keep your files alive forever."
  }
];

const InfoCards: React.FC = () => {
  return (
    <div className="info-cards-container">
      {infoCards.map((card, index) => (
        <div key={index} className="info-box info-card">
          <div className="info-card-step">{card.step}</div>
          <h4>{card.title}</h4>
          <p>{card.description}</p>
        </div>
      ))}
    </div>
  );
};

export default InfoCards;
