import styled from 'styled-components'

const StyledSVG = styled.svg`
  animation: rotate 2s linear infinite;
  z-index: 2;
  width: 50px;
  height: 50px;

  @keyframes rotate {
    100% {
      transform: rotate(360deg);
    }
  }
`

const StyledCircle = styled.circle`
  /* stroke: rgb(20, 184, 166); */
  stroke: #14b8a6;
  stroke-linecap: round;
  animation: dash 1.5s ease-in-out infinite;

  @keyframes dash {
    0% {
      stroke-dasharray: 1, 150;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -35;
    }
    100% {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: -124;
    }
  }
`

export default function SpinnerV2() {
  return (
    <StyledSVG viewBox="0 0 50 50">
      <StyledCircle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        strokeWidth="5"
      ></StyledCircle>
    </StyledSVG>
  )
}
