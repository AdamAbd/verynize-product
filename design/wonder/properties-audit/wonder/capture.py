import ctypes, subprocess, sys, time
from pathlib import Path
root=Path(__file__).parent

def click(actions):
 subprocess.run(['osascript','-e','tell application "Wonder" to activate'],capture_output=True)
 time.sleep(.15)
 subprocess.run(['cliclick',*actions.split()],check=True)
 time.sleep(.8)
def cap(name,wide=False):
 subprocess.run(['osascript','-e','tell application "Wonder" to activate'],capture_output=True)
 time.sleep(.2)
 subprocess.run(['screencapture','-x','-R', '700,183,740,717' if wide else '1160,183,280,717',str(root/(name+'.png'))],check=True)
def scroll(n):
 click('m:1320,700')
 c=ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
 c.CGEventCreateScrollWheelEvent.restype=ctypes.c_void_p
 e=c.CGEventCreateScrollWheelEvent(None,0,1,ctypes.c_int(n))
 c.CGEventPost.argtypes=[ctypes.c_uint32,ctypes.c_void_p]
 c.CGEventPost(0,e)
 time.sleep(.4)
if __name__=='__main__': scroll(int(sys.argv[1]))
