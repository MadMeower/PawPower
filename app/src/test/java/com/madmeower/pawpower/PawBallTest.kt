package com.madmeower.pawpower
import org.junit.Assert.*
import org.junit.Test
class PawBallTest {
    @Test fun speedScalesPlayAndStaysSelectedForNewGames() {
        val relaxed = PawBallViewModel().apply { setGameSpeed(1f); toggle() }
        val fast = PawBallViewModel().apply { setGameSpeed(3f); toggle() }
        repeat(4) { relaxed.advance(0.05) {}; fast.advance(0.05) {} }
        assertTrue(relaxed.state.wait > 0.3)
        assertEquals(0.0, fast.state.wait, 0.0001)
        repeat(2) { fast.advance(0.05) {} }
        assertTrue(fast.state.x < 260.0)
        fast.reset()
        assertEquals(3f, fast.speed, 0f)
        fast.setGameSpeed(100f)
        assertEquals(3f, fast.speed, 0f)
        fast.setGameSpeed(Float.NaN)
        assertEquals(3f, fast.speed, 0f)
    }
    @Test fun sameWebGamePhysicsBounceAndSpeedCap() {
        val s=stepPawBall(PawBallState(x=38.0,y=160.0,vx=-420.0,vy=0.0,wait=0.0),0.008,160.0)
        assertTrue(s.vx>0);assertEquals(37.0,s.x,0.001)
        assertEquals(430.0,kotlin.math.hypot(s.vx,s.vy),0.001)
    }
    @Test fun firstToSevenWinsAndStops() {
        val s=stepPawBall(PawBallState(x=647.0,vx=240.0,you=6,wait=0.0),0.008,160.0)
        assertEquals(7,s.you);assertEquals("You win!",s.winner)
        assertEquals(s,stepPawBall(s,0.02,34.0))
    }
    @Test fun donutScoresMissAndPaddlesStayOnCourt() {
        val s=stepPawBall(PawBallState(x=-8.0,wait=0.0),0.008,-10000.0)
        assertEquals(1,s.donutScore);assertTrue(s.player>=34)
        assertEquals(320.0,s.x,0.001)
    }
}
