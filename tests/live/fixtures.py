import gi,sys
gi.require_version('Gtk','4.0')
from gi.repository import Gtk
number=int(sys.argv[1])
app=Gtk.Application(application_id=f'org.example.OrchardActivationFixture.Window{number}')
def activate(app):
 w=Gtk.ApplicationWindow(application=app,title=f'ORCHARD FIXTURE {number}')
 w.set_default_size(400,300);w.set_child(Gtk.Label(label=f'Test window {number}'));w.present()
app.connect('activate',activate);app.run(None)
