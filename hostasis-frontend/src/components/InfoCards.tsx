import React from 'react';

interface InfoCard {
  step: string;
  title: string;
  description: string;
}

const infoCards: InfoCard[] = [
  {
    step: "1",
    title: "Deposit",
    description: "Deposit DAI which gets put into the Spark Savings vault"
  },
  {
    step: "2",
    title: "Earn",
    description: "Your deposit generates yield automatically"
  },
  {
    step: "3",
    title: "Auto-fund",
    description: "Yield is harvested and used to keep your Swarm files active"
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
